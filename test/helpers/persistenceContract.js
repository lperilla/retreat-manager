/**
 * Behavioural contract shared by every persistence adapter (JSON, in-memory, MongoDB).
 * Each adapter test file calls `definePersistenceContract` with a factory that returns a
 * fresh, empty set of repositories.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { AssignmentStatus } from '../../src/domain/constants.js';
import { createAssignmentOverride } from '../../src/domain/entities/AssignmentOverride.js';
import { createLetter } from '../../src/domain/entities/Letter.js';
import { markPending, markPrinted } from '../../src/domain/entities/PrintStatus.js';
import { createSyncResult } from '../../src/domain/entities/SyncResult.js';
import { createSyncRun } from '../../src/domain/entities/SyncRun.js';
import { createSyncState } from '../../src/domain/entities/SyncState.js';
import { PARTICIPANTS, assignedTo, makeLetter, needsReview } from './domainFixtures.js';
import { FakeClock } from './applicationFakes.js';

/**
 * @typedef {Object} ContractContext
 * @property {import('../../src/infrastructure/persistence/json/createJsonPersistence.js').PersistenceAdapters} persistence
 * @property {FakeClock} clock
 * @property {() => Promise<void>} [cleanup]
 */

/**
 * @param {string} name
 * @param {(clock: FakeClock) => Promise<ContractContext>} factory
 * @param {{ skip?: boolean | string }} [options]
 */
export function definePersistenceContract(name, factory, { skip = false } = {}) {
  describe(`persistence contract: ${name}`, { skip }, () => {
    /** @type {ContractContext} */
    let ctx;
    beforeEach(async () => {
      ctx = await factory(new FakeClock('2026-11-21T10:00:00Z'));
    });
    afterEach(async () => {
      await ctx?.cleanup?.();
    });

    describe('letters', () => {
      it('upserts idempotently: the same batch twice inserts 0 the second time', async () => {
        const { letterStore } = ctx.persistence;
        const batch = [makeLetter({ messageId: 'a' }), makeLetter({ messageId: 'b' })];
        assert.deepEqual(await letterStore.upsertMany(batch), { inserted: 2, updated: 0 });
        assert.deepEqual(await letterStore.upsertMany(batch), { inserted: 0, updated: 2 });
        assert.equal((await letterStore.findAll()).length, 2);
        assert.deepEqual(await letterStore.upsertMany([]), { inserted: 0, updated: 0 });
      });

      it('round-trips every letter field (dates, accents, emojis, attachments, flags)', async () => {
        const { letterStore } = ctx.persistence;
        const letter = makeLetter({
          messageId: 'full',
          subject: 'Carta para Begoña Núñez',
          cleanBody: 'Querida Begoña:\n\nQué ilusión 😊\n\n¡Ánimo!',
          formattedBody: '<p style="color:#c00">Querida <b>Begoña</b>:</p>',
          attachments: [{ filename: 'carta.pdf', mimeType: 'application/pdf', size: 1234, attachmentId: 'att-1' }],
          flags: [{ type: 'HAS_ATTACHMENTS', confidence: 1, reason: 'Incluye 1 adjunto' }],
          assignment: assignedTo(['juan-perez']),
          firstSeenAt: '2026-11-21T09:00:00Z',
          syncRunId: 'run-1',
        });
        await letterStore.upsertMany([letter]);
        const stored = await letterStore.findById('full');
        assert.ok(stored);
        assert.equal(stored.cleanBody, letter.cleanBody);
        assert.equal(stored.formattedBody, letter.formattedBody);
        assert.equal(stored.subject, letter.subject);
        assert.ok(stored.receivedAt instanceof Date);
        assert.equal(stored.receivedAt.toISOString(), letter.receivedAt.toISOString());
        assert.equal(stored.firstSeenAt?.toISOString(), '2026-11-21T09:00:00.000Z');
        assert.deepEqual(stored.attachments, letter.attachments);
        assert.deepEqual(stored.flags, letter.flags);
        assert.deepEqual(stored.assignment, letter.assignment);
        assert.equal(stored.contentHash, letter.contentHash);
        assert.equal(await letterStore.findById('missing'), null);
      });

      it('keeps insert-only novelty fields when a letter is upserted again', async () => {
        const { letterStore } = ctx.persistence;
        const original = makeLetter({ messageId: 'n', firstSeenAt: '2026-11-20T08:00:00Z', syncRunId: 'run-1' });
        await letterStore.upsertMany([original]);
        assert.equal(await letterStore.markSeen({ messageIds: ['n'] }), 1);

        await letterStore.upsertMany([
          createLetter({ ...original, cleanBody: 'Editado', firstSeenAt: null, syncRunId: 'run-9', seenByStaff: false }),
        ]);
        const stored = await letterStore.findById('n');
        assert.equal(stored?.cleanBody, 'Editado');
        assert.equal(stored?.seenByStaff, true);
        assert.equal(stored?.syncRunId, 'run-1');
        assert.equal(stored?.firstSeenAt?.toISOString(), '2026-11-20T08:00:00.000Z');
      });

      it('returns chronological lists, filtered by participant / review status, without deleted letters', async () => {
        const { letterStore } = ctx.persistence;
        await letterStore.upsertMany([
          makeLetter({ messageId: 'late', receivedAt: '2026-11-20T12:00:00Z', assignment: assignedTo(['juan-perez']) }),
          makeLetter({ messageId: 'early', receivedAt: '2026-11-18T12:00:00Z', assignment: assignedTo(['juan-perez', 'ana-martin']) }),
          makeLetter({ messageId: 'tie-b', receivedAt: '2026-11-19T12:00:00Z', assignment: assignedTo(['juan-perez']) }),
          makeLetter({ messageId: 'tie-a', receivedAt: '2026-11-19T12:00:00Z', assignment: assignedTo(['juan-perez']) }),
          makeLetter({ messageId: 'review', assignment: needsReview(['juan-perez']) }),
          makeLetter({ messageId: 'gone', assignment: assignedTo(['juan-perez']), deletedAt: '2026-11-21T00:00:00Z' }),
        ]);
        assert.deepEqual(
          (await letterStore.findByParticipant('juan-perez')).map((l) => l.messageId),
          ['early', 'tie-a', 'tie-b', 'late'],
        );
        assert.deepEqual((await letterStore.findByParticipant('ana-martin')).map((l) => l.messageId), ['early']);
        assert.deepEqual((await letterStore.findNeedingReview()).map((l) => l.messageId), ['review']);
        assert.equal((await letterStore.findAll()).length, 5);
        assert.equal((await letterStore.findAll({ includeDeleted: true })).length, 6);
      });

      it('soft-deletes once and keeps deleted letters among known ids', async () => {
        const { letterStore } = ctx.persistence;
        await letterStore.upsertMany([makeLetter({ messageId: 'a' }), makeLetter({ messageId: 'b' })]);
        const when = new Date('2026-11-21T10:00:00Z');
        assert.equal(await letterStore.softDeleteMany(['a', 'a', 'missing'], when), 1);
        assert.equal(await letterStore.softDeleteMany(['a'], when), 0);
        assert.equal(await letterStore.softDeleteMany([], when), 0);
        const known = await letterStore.getKnownMessageIds();
        assert.equal(known.length, 2);
        assert.equal(known.find((k) => k.messageId === 'a')?.deletedAt?.toISOString(), when.toISOString());
        assert.equal(known.find((k) => k.messageId === 'b')?.deletedAt, null);
        assert.ok(known.every((k) => typeof k.contentHash === 'string' && k.contentHash.length > 0));
      });

      it('restores a soft-deleted letter when it is upserted with deletedAt null', async () => {
        const { letterStore } = ctx.persistence;
        const letter = makeLetter({ messageId: 'back' });
        await letterStore.upsertMany([letter]);
        await letterStore.softDeleteMany(['back'], new Date('2026-11-21T10:00:00Z'));
        await letterStore.upsertMany([createLetter({ ...letter, deletedAt: null })]);
        assert.equal((await letterStore.findById('back'))?.deletedAt, null);
      });

      it('marks letters as seen globally, per participant or by id (active letters only)', async () => {
        const { letterStore } = ctx.persistence;
        await letterStore.upsertMany([
          makeLetter({ messageId: 'j1', assignment: assignedTo(['juan-perez']) }),
          makeLetter({ messageId: 'j2', assignment: assignedTo(['juan-perez', 'ana-martin']) }),
          makeLetter({ messageId: 'a1', assignment: assignedTo(['ana-martin']) }),
          makeLetter({ messageId: 'r1', assignment: needsReview(['juan-perez']) }),
          makeLetter({ messageId: 'd1', assignment: assignedTo(['juan-perez']), deletedAt: '2026-11-21T00:00:00Z' }),
        ]);
        assert.equal(await letterStore.markSeen({ participantId: 'juan-perez' }), 2);
        assert.equal(await letterStore.markSeen({ messageIds: ['a1', 'd1'] }), 1);
        assert.equal(await letterStore.markSeen({}), 1);
        assert.equal(await letterStore.markSeen({}), 0);
        assert.equal((await letterStore.findById('d1'))?.seenByStaff, false);
      });

      it('updates assignments and flags without touching content or novelty', async () => {
        const { letterStore } = ctx.persistence;
        await letterStore.upsertMany([makeLetter({ messageId: 'x', syncRunId: 'run-1', assignment: needsReview() })]);
        const count = await letterStore.updateAssignments([
          {
            messageId: 'x',
            assignment: assignedTo(['juan-perez', 'ana-martin']),
            flags: [{ type: 'MULTI_RECIPIENT', confidence: 1, reason: 'Asignada a 2 participantes' }],
          },
          { messageId: 'missing', assignment: assignedTo(['juan-perez']), flags: [] },
        ]);
        assert.equal(count, 1);
        const stored = await letterStore.findById('x');
        assert.equal(stored?.assignment.status, AssignmentStatus.ASSIGNED);
        assert.deepEqual(stored?.assignment.participantIds, ['juan-perez', 'ana-martin']);
        assert.equal(stored?.flags[0].type, 'MULTI_RECIPIENT');
        assert.equal(stored?.syncRunId, 'run-1');
      });

      it('deletes everything', async () => {
        const { letterStore } = ctx.persistence;
        await letterStore.upsertMany([makeLetter({ messageId: 'a' }), makeLetter({ messageId: 'b' })]);
        assert.equal(await letterStore.deleteAll(), 2);
        assert.deepEqual(await letterStore.findAll({ includeDeleted: true }), []);
      });
    });

    describe('sync state', () => {
      it('returns a default state and saves every field except the lock', async () => {
        const { syncStateRepository } = ctx.persistence;
        const initial = await syncStateRepository.get();
        assert.equal(initial.historyId, null);
        assert.equal(initial.status, 'idle');
        assert.equal(initial.lock, null);

        assert.equal(await syncStateRepository.acquireLock('owner-1', 60), true);
        const result = createSyncResult({
          mode: 'incremental',
          added: 3,
          perParticipantDeltas: [{ participantId: 'juan-perez', newLetters: 2 }],
        });
        await syncStateRepository.save(
          createSyncState({
            historyId: 'h-42',
            selectionKey: "gmail:{\"query\":\"\"}",
            status: 'failed',
            lastError: 'Gmail 503',
            lastAttemptAt: '2026-11-21T09:59:00Z',
            lastSuccessAt: '2026-11-21T09:00:00Z',
            lastResult: result,
            lock: null,
          }),
        );
        const saved = await syncStateRepository.get();
        assert.equal(saved.historyId, 'h-42');
        assert.equal(saved.selectionKey, "gmail:{\"query\":\"\"}");
        assert.equal(saved.status, 'failed');
        assert.equal(saved.lastError, 'Gmail 503');
        assert.equal(saved.lastSuccessAt?.toISOString(), '2026-11-21T09:00:00.000Z');
        assert.deepEqual(saved.lastResult?.perParticipantDeltas, [{ participantId: 'juan-perez', newLetters: 2 }]);
        assert.equal(saved.lock?.owner, 'owner-1');
      });

      it('grants the lock to exactly one of several concurrent owners', async () => {
        const { syncStateRepository } = ctx.persistence;
        const owners = ['a', 'b', 'c', 'd', 'e'];
        const results = await Promise.all(owners.map((owner) => syncStateRepository.acquireLock(owner, 60)));
        assert.equal(results.filter(Boolean).length, 1);
        const winner = owners[results.indexOf(true)];
        assert.equal((await syncStateRepository.get()).lock?.owner, winner);
      });

      it('renews for the same owner, refuses others until expiry, and releases only for the owner', async () => {
        const { syncStateRepository } = ctx.persistence;
        assert.equal(await syncStateRepository.acquireLock('web', 60), true);
        assert.equal(await syncStateRepository.acquireLock('web', 60), true);
        assert.equal(await syncStateRepository.acquireLock('mcp', 60), false);
        assert.equal(await syncStateRepository.releaseLock('mcp'), false);

        ctx.clock.advance(61);
        assert.equal(await syncStateRepository.acquireLock('mcp', 60), true);
        assert.equal(await syncStateRepository.releaseLock('web'), false);
        assert.equal(await syncStateRepository.releaseLock('mcp'), true);
        assert.equal((await syncStateRepository.get()).lock, null);
        assert.equal(await syncStateRepository.acquireLock('web', 60), true);
      });

      it('appends runs and lists the most recent first', async () => {
        const { syncStateRepository } = ctx.persistence;
        const run = (id, startedAt, status = 'success') =>
          createSyncRun({ id, type: 'incremental', startedAt, finishedAt: startedAt, status, added: 1 });
        await syncStateRepository.appendRun(run('r1', '2026-11-21T08:00:00Z'));
        await syncStateRepository.appendRun(run('r2', '2026-11-21T09:00:00Z', 'failed'));
        await syncStateRepository.appendRun(run('r3', '2026-11-21T09:30:00Z'));
        const runs = await syncStateRepository.listRuns(2);
        assert.deepEqual(runs.map((r) => r.id), ['r3', 'r2']);
        assert.ok(runs[0].startedAt instanceof Date);
        assert.equal(runs[1].status, 'failed');

        await syncStateRepository.deleteAll();
        assert.deepEqual(await syncStateRepository.listRuns(10), []);
        assert.equal((await syncStateRepository.get()).historyId, null);
      });
    });

    describe('participants, print status and overrides', () => {
      it('replaces the participant list and sorts it alphabetically', async () => {
        const { participantRepository } = ctx.persistence;
        await participantRepository.replaceAll([...PARTICIPANTS]);
        await participantRepository.replaceAll(PARTICIPANTS.slice(0, 2));
        const all = await participantRepository.findAll();
        assert.deepEqual(all.map((p) => p.id), ['maria-garcia', 'maria-lopez']);
        assert.deepEqual((await participantRepository.findById('maria-garcia'))?.aliases, ['Mari']);
        assert.equal(await participantRepository.findById('juan-perez'), null);
        await assert.rejects(participantRepository.replaceAll([PARTICIPANTS[0], PARTICIPANTS[0]]), {
          code: 'DUPLICATE_PARTICIPANT',
        });
        assert.equal(await participantRepository.deleteAll(), 2);
      });

      it('stores print status per participant', async () => {
        const { printStatusRepository } = ctx.persistence;
        const now = new Date('2026-11-21T10:00:00Z');
        await printStatusRepository.saveMany([markPrinted('juan-perez', now), markPrinted('ana-martin', now)]);
        await printStatusRepository.save(markPending('ana-martin'));
        assert.equal((await printStatusRepository.findByParticipant('juan-perez'))?.printedAt?.toISOString(), now.toISOString());
        assert.equal((await printStatusRepository.findByParticipant('ana-martin'))?.status, 'pending');
        assert.equal(await printStatusRepository.findByParticipant('pedro-sanchez'), null);
        assert.equal((await printStatusRepository.findAll()).length, 2);
        assert.equal(await printStatusRepository.deleteAll(), 2);
      });

      it('stores overrides by messageId', async () => {
        const { overrideRepository } = ctx.persistence;
        const updatedAt = new Date('2026-11-21T10:00:00Z');
        await overrideRepository.save(createAssignmentOverride({ messageId: 'm1', participantIds: ['juan-perez'], updatedAt }));
        await overrideRepository.save(createAssignmentOverride({ messageId: 'm2', participantIds: [], updatedAt }));
        await overrideRepository.save(createAssignmentOverride({ messageId: 'm1', participantIds: ['ana-martin'], updatedAt }));
        assert.deepEqual((await overrideRepository.findByMessageId('m1'))?.participantIds, ['ana-martin']);
        assert.deepEqual((await overrideRepository.findByMessageIds(['m2', 'missing'])).map((o) => o.messageId), ['m2']);
        assert.deepEqual(await overrideRepository.findByMessageIds([]), []);
        assert.equal((await overrideRepository.findAll()).length, 2);
        assert.equal(await overrideRepository.delete('m2'), true);
        assert.equal(await overrideRepository.delete('m2'), false);
        assert.equal(await overrideRepository.deleteAll(), 1);
      });
    });
  });
}
