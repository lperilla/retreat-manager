import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AssignmentStatus, SyncMode, SyncRunStatus, SyncStatus } from '../../src/domain/constants.js';
import { createAssignment } from '../../src/domain/entities/Assignment.js';
import { createAssignmentOverride } from '../../src/domain/entities/AssignmentOverride.js';
import {
  createLetter,
  isNewLetter,
  markLetterSeen,
  mergeIncomingLetter,
  softDeleteLetter,
} from '../../src/domain/entities/Letter.js';
import { compareParticipantsByName, createParticipant, slugify } from '../../src/domain/entities/Participant.js';
import { createPrintStatus, isPendingPrint, markPrinted } from '../../src/domain/entities/PrintStatus.js';
import { completeSyncRun, createSyncRun, failSyncRun } from '../../src/domain/entities/SyncRun.js';
import { createSyncResult } from '../../src/domain/entities/SyncResult.js';
import {
  canAcquireLock,
  cooldownRemainingSeconds,
  createSyncState,
  markSyncFailed,
  markSyncStarted,
  markSyncSucceeded,
  withLockAcquired,
  withLockReleased,
} from '../../src/domain/entities/SyncState.js';
import { AppError } from '../../src/domain/errors.js';
import { assignedTo, makeLetter } from '../helpers/domainFixtures.js';

describe('AppError', () => {
  it('serializes to { code, message } with the Spanish catalog message', () => {
    const error = new AppError('PARTICIPANT_NOT_FOUND', 404);
    assert.deepEqual(error.toJSON(), { code: 'PARTICIPANT_NOT_FOUND', message: 'Participante no encontrado.' });
    assert.equal(error.httpStatus, 404);
    assert.ok(error instanceof Error);
  });
});

describe('Participant', () => {
  it('derives a slug from the display name and cleans aliases', () => {
    const participant = createParticipant({ displayName: '  María José  Núñez ', aliases: ['Majo', 'majo', 'María José Núñez', ' '] });
    assert.equal(participant.id, 'maria-jose-nunez');
    assert.equal(participant.displayName, 'María José Núñez');
    assert.deepEqual(participant.aliases, ['Majo']);
    assert.ok(Object.isFrozen(participant));
  });

  it('validates input', () => {
    assert.throws(() => createParticipant({ displayName: '' }), { code: 'INVALID_PARTICIPANT' });
    assert.throws(() => createParticipant({ id: 'Not A Slug', displayName: 'Ana' }), { code: 'INVALID_PARTICIPANT' });
  });

  it('slugify and Spanish collation', () => {
    assert.equal(slugify('Íñigo Ñúñez!'), 'inigo-nunez');
    const a = createParticipant({ displayName: 'Álvaro' });
    const b = createParticipant({ displayName: 'Beatriz' });
    assert.ok(compareParticipantsByName(a, b) < 0);
  });
});

describe('Assignment', () => {
  it('enforces status/participants consistency', () => {
    assert.throws(() => createAssignment({ status: AssignmentStatus.ASSIGNED, participantIds: [] }), { code: 'INVALID_ASSIGNMENT' });
    assert.throws(() => createAssignment({ status: AssignmentStatus.NEEDS_REVIEW, participantIds: ['a'] }), { code: 'INVALID_ASSIGNMENT' });
    assert.throws(() => createAssignment({ status: 'WHATEVER' }), { code: 'INVALID_ASSIGNMENT' });
  });

  it('overrides deduplicate participant ids', () => {
    const override = createAssignmentOverride({ messageId: 'm', participantIds: ['a', 'a', 'b'], updatedAt: '2025-11-04T00:00:00Z' });
    assert.deepEqual(override.participantIds, ['a', 'b']);
  });
});

describe('Letter', () => {
  it('validates required fields', () => {
    assert.throws(() => createLetter({ messageId: '', receivedAt: new Date() }), { code: 'INVALID_LETTER' });
    assert.throws(() => createLetter({ messageId: 'x', receivedAt: 'not a date' }), { code: 'INVALID_LETTER' });
  });

  it('preserves body fidelity (paragraphs, accents, ñ, emojis) and defaults to NEEDS_REVIEW', () => {
    const body = 'Querida Begoña:\r\n\r\nQué ilusión 😊\n\n¡Ánimo!';
    const letter = createLetter({ messageId: 'x', receivedAt: '2025-11-03T10:00:00Z', cleanBody: body });
    assert.equal(letter.cleanBody, 'Querida Begoña:\n\nQué ilusión 😊\n\n¡Ánimo!');
    assert.equal(letter.assignment.status, AssignmentStatus.NEEDS_REVIEW);
    assert.equal(letter.seenByStaff, false);
    assert.equal(letter.deletedAt, null);
  });

  it('content hash ignores assignment/novelty and changes with the content', () => {
    const letter = makeLetter({ messageId: 'h' });
    const reassigned = createLetter({ ...letter, assignment: assignedTo(['juan-perez']), seenByStaff: true });
    const edited = createLetter({ ...letter, cleanBody: `${letter.cleanBody}!` });
    assert.equal(reassigned.contentHash, letter.contentHash);
    assert.notEqual(edited.contentHash, letter.contentHash);
  });

  it('novelty: new letters are unseen; merge keeps novelty data of known letters', () => {
    const now = new Date('2025-11-04T10:00:00Z');
    const later = new Date('2025-11-05T10:00:00Z');
    const incoming = makeLetter({ messageId: 'n' });

    const stored = mergeIncomingLetter(null, incoming, { now, syncRunId: 'run-1' });
    assert.equal(stored.seenByStaff, false);
    assert.equal(stored.syncRunId, 'run-1');
    assert.equal(stored.firstSeenAt?.toISOString(), now.toISOString());
    assert.equal(isNewLetter(stored), true);

    const seen = markLetterSeen(stored);
    assert.equal(isNewLetter(seen), false);

    const merged = mergeIncomingLetter(softDeleteLetter(seen, now), incoming, { now: later, syncRunId: 'run-2' });
    assert.equal(merged.seenByStaff, true);
    assert.equal(merged.syncRunId, 'run-1');
    assert.equal(merged.firstSeenAt?.toISOString(), now.toISOString());
    assert.equal(merged.deletedAt, null);
  });

  it('soft-deleted letters are never "new"', () => {
    const letter = softDeleteLetter(makeLetter(), new Date('2025-11-04T00:00:00Z'));
    assert.equal(isNewLetter(letter), false);
  });
});

describe('PrintStatus', () => {
  it('missing status is pending; printed carries printedAt', () => {
    assert.equal(isPendingPrint(undefined), true);
    const printed = markPrinted('ana', new Date('2025-11-04T10:00:00Z'));
    assert.equal(isPendingPrint(printed), false);
    assert.equal(printed.printedAt?.toISOString(), '2025-11-04T10:00:00.000Z');
    assert.throws(() => createPrintStatus({ participantId: 'ana', status: 'lost' }), { code: 'INVALID_PRINT_STATUS' });
  });
});

describe('SyncState', () => {
  const t0 = new Date('2025-11-04T10:00:00Z');
  const result = createSyncResult({ mode: SyncMode.INCREMENTAL, added: 3 });

  it('advances the cursor only on success', () => {
    const started = markSyncStarted(createSyncState({ historyId: '100' }), { now: t0 });
    assert.equal(started.status, SyncStatus.RUNNING);

    const failed = markSyncFailed(started, { now: t0, error: 'Gmail 500' });
    assert.equal(failed.historyId, '100');
    assert.equal(failed.status, SyncStatus.FAILED);
    assert.equal(failed.lastError, 'Gmail 500');

    const succeeded = markSyncSucceeded(started, { now: t0, nextCursor: '150', result });
    assert.equal(succeeded.historyId, '150');
    assert.equal(succeeded.status, SyncStatus.IDLE);
    assert.equal(succeeded.lastError, null);
    assert.equal(succeeded.lastFullSyncAt, null);
    assert.equal(succeeded.lastResult?.added, 3);
  });

  it('a failure keeps the last good result', () => {
    const good = markSyncSucceeded(createSyncState(), { now: t0, nextCursor: '1', result });
    const failed = markSyncFailed(good, { now: t0, error: 'boom' });
    assert.equal(failed.lastResult?.added, 3);
    assert.equal(failed.lastSuccessAt?.toISOString(), t0.toISOString());
  });

  it('records lastFullSyncAt after a full sync and reports fallback', () => {
    const full = createSyncResult({ mode: SyncMode.FULL, requestedMode: SyncMode.INCREMENTAL });
    assert.equal(full.fallbackToFull, true);
    const state = markSyncSucceeded(createSyncState(), { now: t0, nextCursor: '9', result: full });
    assert.equal(state.lastFullSyncAt?.toISOString(), t0.toISOString());
  });

  it('lock: refuses a concurrent owner, allows re-acquiring an expired lock, releases only for the owner', () => {
    const locked = withLockAcquired(createSyncState(), 'web-1', t0, 300);
    assert.equal(canAcquireLock(locked, 'mcp-1', new Date(t0.getTime() + 60_000)), false);
    assert.throws(() => withLockAcquired(locked, 'mcp-1', new Date(t0.getTime() + 60_000), 300), {
      code: 'SYNC_IN_PROGRESS',
      httpStatus: 409,
    });

    const afterExpiry = new Date(t0.getTime() + 301_000);
    const relocked = withLockAcquired(locked, 'mcp-1', afterExpiry, 300);
    assert.equal(relocked.lock?.owner, 'mcp-1');

    assert.equal(withLockReleased(relocked, 'web-1').lock?.owner, 'mcp-1');
    assert.equal(withLockReleased(relocked, 'mcp-1').lock, null);
  });

  it('cooldown is measured from the last attempt', () => {
    const state = markSyncStarted(createSyncState(), { now: t0 });
    assert.equal(cooldownRemainingSeconds(state, new Date(t0.getTime() + 10_000), 30), 20);
    assert.equal(cooldownRemainingSeconds(state, new Date(t0.getTime() + 30_000), 30), 0);
    assert.equal(cooldownRemainingSeconds(createSyncState(), t0, 30), 0);
  });

  it('rejects an unknown status', () => {
    assert.throws(() => createSyncState({ status: 'sleeping' }), { code: 'INVALID_SYNC_STATE' });
  });
});

describe('SyncRun and SyncResult', () => {
  const startedAt = new Date('2025-11-04T10:00:00Z');

  it('complete and fail compute the duration', () => {
    const run = createSyncRun({ id: 'run-1', type: SyncMode.INCREMENTAL, startedAt });
    assert.equal(run.status, SyncRunStatus.RUNNING);
    const done = completeSyncRun(run, { finishedAt: new Date('2025-11-04T10:00:02Z'), added: 3, updated: 1 });
    assert.equal(done.status, SyncRunStatus.SUCCESS);
    assert.equal(done.durationMs, 2000);
    assert.equal(done.added, 3);
    const failed = failSyncRun(run, { finishedAt: new Date('2025-11-04T10:00:01Z'), error: 'Gmail 503' });
    assert.equal(failed.status, SyncRunStatus.FAILED);
    assert.equal(failed.error, 'Gmail 503');
  });

  it('rejects an unknown sync mode', () => {
    assert.throws(() => createSyncRun({ id: 'r', type: 'partial', startedAt }), { code: 'INVALID_SYNC_MODE' });
    assert.throws(() => createSyncResult({ mode: 'partial' }), { code: 'INVALID_SYNC_MODE' });
  });
});
