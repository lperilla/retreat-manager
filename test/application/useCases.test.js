import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AssignmentStatus, SignalType, SyncStatus } from '../../src/domain/constants.js';
import { createParticipant } from '../../src/domain/entities/Participant.js';
import { createSyncState } from '../../src/domain/entities/SyncState.js';
import { FileExportStorage } from '../../src/infrastructure/rendering/FileExportStorage.js';
import { PARTICIPANTS } from '../helpers/domainFixtures.js';
import { ScriptedMailSource, buildTestContainer, makeMessage } from '../helpers/applicationFakes.js';

const MESSAGES = [
  makeMessage({ messageId: 'u1', subject: 'Carta para Juan', receivedAt: new Date('2026-11-18T09:00:00Z') }),
  makeMessage({
    messageId: 'u2',
    subject: 'Ánimo',
    body: 'Querido Juan:\nQué ilusión que estés allí. Te mandamos fotos del pueblo.',
    receivedAt: new Date('2026-11-19T23:30:00Z'),
  }),
  makeMessage({ messageId: 'u3', subject: 'Carta para Juan y Lucía', receivedAt: new Date('2026-11-18T12:00:00Z') }),
  makeMessage({ messageId: 'u4', subject: 'Ánimo', body: 'Querida María:\nMucha fuerza desde Córdoba.' }),
  makeMessage({
    messageId: 'u5',
    subject: 'Respuesta automática: Carta para Pedro',
    headers: { 'Auto-Submitted': 'auto-replied' },
  }),
  makeMessage({ messageId: 'u6', subject: 'Carta para Carmen Ruiz', body: 'Querida Carmen:\nTe queremos.' }),
];

async function seededContainer(extra = {}) {
  const mailSource = new ScriptedMailSource(() => ({
    letters: MESSAGES,
    deletedMessageIds: [],
    nextCursor: 'h-1',
    isFullListing: true,
  }));
  const built = await buildTestContainer({ mailSource, ...extra });
  await built.container.useCases.syncMailbox.execute();
  return built;
}

describe('GetDashboardOverviewUseCase', () => {
  it('returns KPIs with tie arrays, directory rows and the sync widget state', async () => {
    const { container } = await seededContainer();
    const overview = await container.useCases.getDashboardOverview.execute();

    assert.equal(overview.kpis.totalLetters, 6);
    assert.equal(overview.kpis.reviewQueueSize, 2);
    assert.equal(overview.kpis.newLettersCount, 6);
    assert.deepEqual(overview.kpis.mostLetters, {
      count: 3,
      participants: [{ id: 'juan-perez', displayName: 'Juan Pérez', known: true }],
    });
    assert.equal(overview.kpis.fewestLetters.count, 0);
    assert.deepEqual(
      overview.kpis.zeroLetterParticipants.map((p) => p.id),
      ['ana-martin', 'maria-garcia', 'maria-lopez'],
    );
    assert.equal(overview.kpis.flaggedLettersCount, 1);
    assert.equal(overview.directory.rows.length, PARTICIPANTS.length);
    assert.equal(overview.sync.status, SyncStatus.IDLE);
    assert.equal(overview.sync.lastResult?.added, 6);
  });

  it('filters, searches and sorts the directory', async () => {
    const { container } = await seededContainer();
    const run = (input) => container.useCases.getDashboardOverview.execute(input).then((o) => o.directory.rows.map((r) => r.participantId));

    assert.deepEqual(await run({ filter: 'with-letters', sortBy: 'count' }), ['juan-perez', 'lucia-fernandez', 'pedro-sanchez']);
    assert.deepEqual(await run({ filter: 'without-letters' }), ['ana-martin', 'maria-garcia', 'maria-lopez']);
    assert.deepEqual(await run({ filter: 'with-warnings' }), ['pedro-sanchez']);
    assert.deepEqual(await run({ search: 'MARIA' }), ['maria-garcia', 'maria-lopez']);
    assert.deepEqual(await run({ search: 'juanito' }), ['juan-perez']);

    await container.useCases.updatePrintStatus.execute({ participantIds: ['lucia-fernandez'], status: 'printed' });
    assert.deepEqual(await run({ filter: 'printed' }), ['lucia-fernandez']);
    // "Seen" belongs to the letter: Lucía's only letter is shared with Juan, so it is seen too.
    await container.useCases.markLettersSeen.execute({ participantId: 'juan-perez' });
    assert.deepEqual(await run({ filter: 'with-news' }), ['pedro-sanchez']);

    await assert.rejects(container.useCases.getDashboardOverview.execute({ filter: 'nope' }), { code: 'VALIDATION_ERROR' });
  });
});

describe('GroupParticipantLettersUseCase', () => {
  it('returns chronological letters with flags and assignment evidence', async () => {
    const { container } = await seededContainer();
    const result = await container.useCases.groupParticipantLetters.execute({ participantId: 'juan-perez' });
    assert.deepEqual(result.letters.map((l) => l.messageId), ['u1', 'u3', 'u2']);
    assert.equal(result.letters[2].assignment.signal, SignalType.BODY_EXPLICIT);
    assert.equal(result.letters[2].assignment.matchedText, 'Querido Juan:');
    assert.equal(result.letters[1].flags[0].type, 'MULTI_RECIPIENT');
    assert.equal(typeof result.letters[0].receivedAt, 'string');
    assert.equal(result.printStatus.status, 'pending');
  });

  it('applies an exclusive afterDate in the configured time zone', async () => {
    const { container } = await seededContainer();
    // u2 was received at 00:30 on Nov 20 in Madrid.
    const result = await container.useCases.groupParticipantLetters.execute({ participantId: 'juan-perez', afterDate: '2026-11-19' });
    assert.deepEqual(result.letters.map((l) => l.messageId), ['u2']);
  });

  it('throws PARTICIPANT_NOT_FOUND for unknown participants', async () => {
    const { container } = await seededContainer();
    await assert.rejects(container.useCases.groupParticipantLetters.execute({ participantId: 'ghost' }), {
      code: 'PARTICIPANT_NOT_FOUND',
      httpStatus: 404,
      message: 'Participante no encontrado.',
    });
  });
});

describe('ReviewAssignmentUseCase', () => {
  it('lists the review queue with ranked suggestions', async () => {
    const { container } = await seededContainer();
    const queue = await container.useCases.reviewAssignment.listQueue();
    assert.deepEqual(queue.letters.map((l) => l.messageId).sort(), ['u4', 'u6']);
    const ambiguous = queue.letters.find((l) => l.messageId === 'u4');
    assert.deepEqual(ambiguous?.assignment.suggestions.map((s) => s.id), ['maria-garcia', 'maria-lopez']);
  });

  it('assigns, leaves unassigned and resets to automatic', async () => {
    const { container } = await seededContainer();
    const review = container.useCases.reviewAssignment;

    const assigned = await review.assign({ messageId: 'u4', participantIds: ['maria-lopez', 'maria-garcia'] });
    assert.equal(assigned.assignment.status, AssignmentStatus.ASSIGNED);
    assert.equal(assigned.assignment.manual, true);
    assert.deepEqual(assigned.assignment.participants.map((p) => p.id), ['maria-garcia', 'maria-lopez']);
    assert.ok(assigned.flags.some((f) => f.type === 'MULTI_RECIPIENT'));

    const left = await review.leaveUnassigned({ messageId: 'u6' });
    assert.equal(left.assignment.status, AssignmentStatus.UNASSIGNED);
    assert.equal((await review.listQueue()).total, 0);
    assert.equal((await container.useCases.getDashboardOverview.execute()).kpis.unassignedCount, 1);

    const reset = await review.resetToAutomatic({ messageId: 'u4' });
    assert.equal(reset.assignment.status, AssignmentStatus.NEEDS_REVIEW);
    assert.equal(reset.flags.some((f) => f.type === 'MULTI_RECIPIENT'), false);
    assert.equal(await container.repositories.overrideRepository.findByMessageId('u4'), null);
  });

  it('validates letters and participants', async () => {
    const { container } = await seededContainer();
    const review = container.useCases.reviewAssignment;
    await assert.rejects(review.assign({ messageId: 'nope', participantIds: ['juan-perez'] }), { code: 'LETTER_NOT_FOUND' });
    await assert.rejects(review.assign({ messageId: 'u4', participantIds: ['ghost'] }), { code: 'PARTICIPANT_NOT_FOUND' });
    await assert.rejects(review.assign({ messageId: 'u4', participantIds: [] }), { code: 'VALIDATION_ERROR' });
  });
});

describe('RecomputeAssignmentsUseCase', () => {
  it('re-runs assignment after participants change and respects manual overrides', async () => {
    const { container } = await seededContainer();
    const { useCases, repositories } = container;
    await useCases.reviewAssignment.assign({ messageId: 'u1', participantIds: ['pedro-sanchez'] });

    await repositories.participantRepository.replaceAll([
      ...PARTICIPANTS,
      createParticipant({ id: 'carmen-ruiz', displayName: 'Carmen Ruiz' }),
    ]);
    const summary = await useCases.recomputeAssignments.execute();

    assert.equal(summary.changed, 1);
    assert.equal(summary.manualOverrides, 1);
    assert.equal(summary.changes[0].messageId, 'u6');
    assert.equal(summary.changes[0].before.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(summary.changes[0].after.participants.map((p) => p.id), ['carmen-ruiz']);
    assert.deepEqual((await repositories.letterStore.findById('u6'))?.assignment.participantIds, ['carmen-ruiz']);
    assert.deepEqual((await repositories.letterStore.findById('u1'))?.assignment.participantIds, ['pedro-sanchez']);

    assert.equal((await useCases.recomputeAssignments.execute()).changed, 0);
  });
});

describe('SearchRawLettersUseCase', () => {
  it('finds letters by subject, sender or body, accent-insensitive, including unassigned ones', async () => {
    const { container } = await seededContainer();
    const search = container.useCases.searchRawLetters;

    const cordoba = await search.execute({ query: 'cordoba' });
    assert.deepEqual(cordoba.results.map((r) => r.messageId), ['u4']);
    assert.equal(cordoba.results[0].assignment.status, AssignmentStatus.NEEDS_REVIEW);
    assert.match(cordoba.results[0].snippet, /Córdoba/);
    assert.equal('body' in cordoba.results[0], false);

    assert.equal((await search.execute({ query: 'fotos pueblo' })).total, 1);
    assert.equal((await search.execute({ query: 'carta juan', limit: 1 })).results.length, 1);
  });

  it('validates query and limit (<= 50)', async () => {
    const { container } = await seededContainer();
    const search = container.useCases.searchRawLetters;
    await assert.rejects(search.execute({ query: 'a' }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(search.execute({ query: 'carta', limit: 51 }), { code: 'VALIDATION_ERROR' });
  });
});

describe('ExportBatchLettersUseCase', () => {
  /** @type {string} */
  let exportDir;
  before(async () => {
    exportDir = await mkdtemp(join(tmpdir(), 'retreat-export-'));
  });
  after(async () => {
    await rm(exportDir, { recursive: true, force: true });
  });

  it('writes a JSON export under EXPORT_DIR and optionally marks participants as printed', async () => {
    const { container } = await seededContainer({ overrides: { exportStorage: new FileExportStorage({ exportDir }) } });
    const result = await container.useCases.exportBatchLetters.execute({
      participantIds: ['lucia-fernandez', 'juan-perez'],
      format: 'json',
      markAsPrinted: true,
    });

    assert.match(result.filename, /^cartas_lote-2_20261121-110000\.json$/);
    assert.ok(result.filePath.startsWith(exportDir));
    assert.equal(result.participantCount, 2);
    assert.equal(result.letterCount, 4);
    assert.equal(result.uniqueLetterCount, 3);

    const document = JSON.parse(await readFile(result.filePath, 'utf8'));
    assert.deepEqual(document.participants.map((p) => p.id), ['juan-perez', 'lucia-fernandez']);
    assert.deepEqual(document.participants[0].letters.map((l) => l.messageId), ['u1', 'u3', 'u2']);

    const statuses = await container.repositories.printStatusRepository.findAll();
    assert.deepEqual(statuses.map((s) => s.participantId).sort(), ['juan-perez', 'lucia-fernandez']);
  });

  it('rejects formats without a renderer and empty selections', async () => {
    const { container } = await seededContainer({ overrides: { exportStorage: new FileExportStorage({ exportDir }) } });
    await assert.rejects(container.useCases.exportBatchLetters.execute({ participantIds: ['juan-perez'], format: 'docx' }), {
      code: 'UNSUPPORTED_EXPORT_FORMAT',
    });
    await assert.rejects(container.useCases.exportBatchLetters.execute({ participantIds: [], format: 'json' }), {
      code: 'EMPTY_SELECTION',
    });
  });
});

describe('GetSyncStatusUseCase', () => {
  it('reports a run interrupted without an active lock as failed, and lists runs', async () => {
    const { container } = await seededContainer();
    const status = await container.useCases.getSyncStatus.execute();
    assert.equal(status.canSync, true);
    assert.equal((await container.useCases.getSyncStatus.listRuns()).runs[0].status, 'success');

    const state = await container.repositories.syncStateRepository.get();
    await container.repositories.syncStateRepository.save(createSyncState({ ...state, status: SyncStatus.RUNNING }));
    const interrupted = await container.useCases.getSyncStatus.execute();
    assert.equal(interrupted.status, SyncStatus.FAILED);
    assert.equal(interrupted.lastSyncFailed, true);
    assert.match(interrupted.lastError ?? '', /interrumpió/);
  });
});

describe('UpdatePrintStatusUseCase', () => {
  it('toggles pending/printed and validates participants', async () => {
    const { container } = await seededContainer();
    const update = container.useCases.updatePrintStatus;
    const printed = await update.execute({ participantIds: ['juan-perez'], status: 'printed' });
    assert.equal(printed.statuses[0].status, 'printed');
    assert.ok(printed.statuses[0].printedAt);
    const pending = await update.execute({ participantIds: ['juan-perez'], status: 'pending' });
    assert.deepEqual(pending.statuses[0], { participantId: 'juan-perez', status: 'pending', printedAt: null });
    await assert.rejects(update.execute({ participantIds: ['ghost'], status: 'printed' }), { code: 'PARTICIPANT_NOT_FOUND' });
  });
});
