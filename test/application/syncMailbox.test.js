import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CursorExpiredError } from '../../src/application/ports/MailSourcePort.js';
import { AssignmentStatus, SignalType, SyncMode, SyncRunStatus, SyncStatus } from '../../src/domain/constants.js';
import { createSyncState } from '../../src/domain/entities/SyncState.js';
import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { JsonLetterStoreRepository } from '../../src/infrastructure/persistence/json/JsonLetterStoreRepository.js';
import { FakeClock, ScriptedMailSource, buildTestContainer, deferred, makeMessage } from '../helpers/applicationFakes.js';

const changes = (letters, nextCursor, extra = {}) => ({ letters, deletedMessageIds: [], nextCursor, ...extra });

describe('SyncMailboxUseCase', () => {
  it('runs a full sync when there is no cursor and stores the next cursor', async () => {
    const batch = [makeMessage({ subject: 'Carta para Juan' }), makeMessage({ subject: 'Carta para Ana' })];
    const mailSource = new ScriptedMailSource(() => changes(batch, 'h-100', { isFullListing: true }));
    const { container } = await buildTestContainer({ mailSource });

    const result = await container.useCases.syncMailbox.execute({ mode: SyncMode.INCREMENTAL });
    assert.equal(result.mode, SyncMode.FULL);
    assert.equal(result.requestedMode, SyncMode.INCREMENTAL);
    assert.equal(result.added, 2);
    assert.deepEqual(mailSource.calls, [null]);

    const state = await container.repositories.syncStateRepository.get();
    assert.equal(state.historyId, 'h-100');
    assert.equal(state.status, SyncStatus.IDLE);
    assert.ok(state.lastSuccessAt);
    assert.ok(state.lastFullSyncAt);
    assert.equal(state.lock, null);
  });

  it('is idempotent: the same batch twice adds 0 letters', async () => {
    const batch = [makeMessage({ subject: 'Carta para Juan' }), makeMessage({ subject: 'Carta para Pedro' })];
    const mailSource = new ScriptedMailSource((cursor) => changes(batch, cursor ? `${cursor}+` : 'h-1'));
    const { container } = await buildTestContainer({ mailSource });

    const first = await container.useCases.syncMailbox.execute();
    const second = await container.useCases.syncMailbox.execute();
    assert.equal(first.added, 2);
    assert.equal(second.added, 0);
    assert.equal(second.updated, 0);
    assert.equal(second.unchanged, 2);
    assert.deepEqual(second.perParticipantDeltas, []);
    assert.equal((await container.repositories.letterStore.findAll()).length, 2);
  });

  it('reports per-participant deltas for new letters', async () => {
    const batch = [
      makeMessage({ subject: 'Carta para Juan' }),
      makeMessage({ subject: 'Carta para Juan y Lucía' }),
      makeMessage({ subject: 'Ánimo', body: 'Querida María:\nÁnimo.' }),
    ];
    const { container } = await buildTestContainer({ mailSource: new ScriptedMailSource(() => changes(batch, 'h-1')) });
    const result = await container.useCases.syncMailbox.execute();
    assert.deepEqual(result.perParticipantDeltas, [
      { participantId: 'juan-perez', newLetters: 2 },
      { participantId: 'lucia-fernandez', newLetters: 1 },
    ]);
  });

  it('does NOT advance the cursor when persistence fails, and keeps serving the last good data', async () => {
    class FailingLetterStore extends JsonLetterStoreRepository {
      async upsertMany() {
        throw new Error('disk full');
      }
    }
    const clock = new FakeClock();
    const persistence = { ...createJsonPersistence({ directory: null, clock }), letterStore: new FailingLetterStore() };
    await persistence.syncStateRepository.save(createSyncState({ historyId: 'h-good' }));
    const mailSource = new ScriptedMailSource(() => changes([makeMessage({ subject: 'Carta para Juan' })], 'h-next'));
    const { container } = await buildTestContainer({ mailSource, persistence, clock });

    await assert.rejects(container.useCases.syncMailbox.execute(), { code: 'SYNC_FAILED', httpStatus: 502 });

    const state = await container.repositories.syncStateRepository.get();
    assert.equal(state.historyId, 'h-good');
    assert.equal(state.status, SyncStatus.FAILED);
    assert.match(state.lastError ?? '', /disk full/);
    assert.equal(state.lock, null);

    const [run] = await container.repositories.syncStateRepository.listRuns(1);
    assert.equal(run.status, SyncRunStatus.FAILED);
    assert.match(run.error ?? '', /disk full/);

    const status = await container.useCases.getSyncStatus.execute();
    assert.equal(status.lastSyncFailed, true);
  });

  it('falls back to a full sync when the cursor has expired', async () => {
    const clock = new FakeClock();
    const persistence = createJsonPersistence({ directory: null, clock });
    await persistence.syncStateRepository.save(createSyncState({ historyId: 'h-stale' }));
    const mailSource = new ScriptedMailSource((cursor) => {
      if (cursor === 'h-stale') throw new CursorExpiredError('History too old', { cursor });
      return changes([makeMessage({ subject: 'Carta para Pedro' })], 'h-fresh', { isFullListing: true });
    });
    const { container } = await buildTestContainer({ mailSource, persistence, clock });

    const result = await container.useCases.syncMailbox.execute({ mode: SyncMode.INCREMENTAL });
    assert.deepEqual(mailSource.calls, ['h-stale', null]);
    assert.equal(result.mode, SyncMode.FULL);
    assert.equal(result.fallbackToFull, true);
    assert.equal(result.added, 1);
    assert.equal((await container.repositories.syncStateRepository.get()).historyId, 'h-fresh');
  });

  it('refuses a concurrent run while the lock is held', async () => {
    const gate = deferred();
    const mailSource = new ScriptedMailSource(async () => {
      await gate.promise;
      return changes([makeMessage({ subject: 'Carta para Ana' })], 'h-1');
    });
    const { container } = await buildTestContainer({ mailSource });

    const first = await container.useCases.syncMailbox.start({ mode: SyncMode.INCREMENTAL });
    const status = await container.useCases.getSyncStatus.execute();
    assert.equal(status.running, true);
    assert.equal(status.canSync, false);

    await assert.rejects(container.useCases.syncMailbox.execute(), { code: 'SYNC_IN_PROGRESS', httpStatus: 409 });

    gate.resolve(undefined);
    const result = await first.completion;
    assert.equal(result.added, 1);
    assert.equal((await container.repositories.syncStateRepository.get()).lock, null);
  });

  it('re-acquires a lock left behind by a crashed process once it expires', async () => {
    const clock = new FakeClock();
    const mailSource = new ScriptedMailSource(() => changes([], 'h-1'));
    const { container } = await buildTestContainer({ mailSource, clock });
    assert.equal(await container.repositories.syncStateRepository.acquireLock('ghost', 60), true);

    await assert.rejects(container.useCases.syncMailbox.execute(), { code: 'SYNC_IN_PROGRESS' });
    clock.advance(61);
    const result = await container.useCases.syncMailbox.execute();
    assert.equal(result.added, 0);
  });

  it('enforces the cooldown between syncs', async () => {
    const clock = new FakeClock();
    const mailSource = new ScriptedMailSource(() => changes([], 'h-1'));
    const { container } = await buildTestContainer({ mailSource, clock, minIntervalSeconds: 30 });

    await container.useCases.syncMailbox.execute();
    clock.advance(10);
    await assert.rejects(container.useCases.syncMailbox.execute(), (error) => {
      assert.equal(error.code, 'SYNC_COOLDOWN');
      assert.equal(error.httpStatus, 429);
      assert.equal(error.details.retryAfterSeconds, 20);
      return true;
    });
    assert.equal((await container.useCases.getSyncStatus.execute()).cooldownRemainingSeconds, 20);
    clock.advance(20);
    await container.useCases.syncMailbox.execute();
    assert.equal(mailSource.calls.length, 2);
  });

  it('manual overrides and print status survive re-syncs (including content updates)', async () => {
    const original = makeMessage({ messageId: 'keep-me', subject: 'Carta para Juan', body: 'Querido Juan:\nÁnimo.' });
    let current = original;
    const mailSource = new ScriptedMailSource(() => changes([current], 'h-x', { isFullListing: true }));
    const { container } = await buildTestContainer({ mailSource });
    const { useCases, repositories } = container;

    await useCases.syncMailbox.execute();
    assert.deepEqual((await repositories.letterStore.findById('keep-me'))?.assignment.participantIds, ['juan-perez']);

    await useCases.reviewAssignment.assign({ messageId: 'keep-me', participantIds: ['ana-martin'] });
    await useCases.updatePrintStatus.execute({ participantIds: ['juan-perez'], status: 'printed' });

    current = { ...original, body: 'Querido Juan:\nÁnimo, campeón (versión corregida).' };
    const result = await useCases.syncMailbox.execute({ mode: SyncMode.FULL });
    assert.equal(result.updated, 1);

    const letter = await repositories.letterStore.findById('keep-me');
    assert.equal(letter?.assignment.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(letter?.assignment.participantIds, ['ana-martin']);
    assert.equal(letter?.assignment.signal, SignalType.MANUAL);
    assert.match(letter?.cleanBody ?? '', /versión corregida/);
    assert.equal((await repositories.printStatusRepository.findByParticipant('juan-perez'))?.status, 'printed');
  });

  it('soft-deletes letters deleted at the source and letters missing from a full listing', async () => {
    const a = makeMessage({ messageId: 'a', subject: 'Carta para Juan' });
    const b = makeMessage({ messageId: 'b', subject: 'Carta para Juan' });
    const c = makeMessage({ messageId: 'c', subject: 'Carta para Juan' });
    const mailSource = new ScriptedMailSource((cursor, call) => {
      if (call === 0) return changes([a, b, c], 'h-1', { isFullListing: true });
      if (call === 1) return { letters: [], deletedMessageIds: ['a'], nextCursor: 'h-2' };
      if (call === 2) return changes([c], 'h-3', { isFullListing: true });
      return changes([b, c], 'h-4', { isFullListing: true });
    });
    const { container } = await buildTestContainer({ mailSource });
    const { useCases, repositories } = container;
    const juanCount = async () =>
      (await useCases.getDashboardOverview.execute()).directory.rows.find((r) => r.participantId === 'juan-perez')
        ?.letterCount;

    await useCases.syncMailbox.execute();
    assert.equal(await juanCount(), 3);

    assert.equal((await useCases.syncMailbox.execute()).deleted, 1);
    assert.equal(await juanCount(), 2);

    assert.equal((await useCases.syncMailbox.execute({ mode: SyncMode.FULL })).deleted, 1);
    assert.equal(await juanCount(), 1);
    assert.ok((await repositories.letterStore.findById('b'))?.deletedAt);

    const restored = await useCases.syncMailbox.execute({ mode: SyncMode.FULL });
    assert.equal(restored.updated, 1);
    assert.equal(await juanCount(), 2);
  });

  it('tracks novelty: new letters are unseen, markSeen works per participant and globally, and survives updates', async () => {
    let batch = [
      makeMessage({ messageId: 'n1', subject: 'Carta para Juan' }),
      makeMessage({ messageId: 'n2', subject: 'Carta para Ana' }),
      makeMessage({ messageId: 'n3', subject: 'Ánimo', body: 'Querida María:\nFuerza.' }),
    ];
    const mailSource = new ScriptedMailSource(() => changes(batch, 'h-1', { isFullListing: true }));
    const { container } = await buildTestContainer({ mailSource });
    const { useCases, repositories } = container;

    await useCases.syncMailbox.execute();
    const fresh = await useCases.getNewLetters.execute();
    assert.equal(fresh.total, 3);
    assert.deepEqual(fresh.groups.map((g) => g.participant.id), ['ana-martin', 'juan-perez']);
    assert.equal(fresh.unassigned.count, 1);
    const stored = await repositories.letterStore.findById('n1');
    assert.equal(stored?.seenByStaff, false);
    assert.equal(stored?.syncRunId, 'run-1');
    assert.ok(stored?.firstSeenAt);

    assert.deepEqual(await useCases.markLettersSeen.execute({ participantId: 'juan-perez' }), {
      scope: 'participant',
      participantId: 'juan-perez',
      updated: 1,
    });
    assert.equal((await useCases.getNewLetters.execute({ participantId: 'juan-perez' })).total, 0);
    assert.equal((await useCases.getDashboardOverview.execute()).kpis.newLettersCount, 2);

    batch = [{ ...batch[0], body: 'Texto corregido por la familia.' }, batch[1], batch[2]];
    await useCases.syncMailbox.execute({ mode: SyncMode.FULL });
    const updated = await repositories.letterStore.findById('n1');
    assert.equal(updated?.seenByStaff, true);
    assert.equal(updated?.syncRunId, 'run-1');

    assert.equal((await useCases.markLettersSeen.execute()).updated, 2);
    assert.equal((await useCases.getDashboardOverview.execute()).kpis.newLettersCount, 0);
  });

  it('rejects an invalid mode', async () => {
    const { container } = await buildTestContainer();
    await assert.rejects(container.useCases.syncMailbox.execute({ mode: 'partial' }), { code: 'INVALID_SYNC_MODE' });
  });
});
