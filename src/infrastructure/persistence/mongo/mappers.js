/**
 * Conversions between domain entities and MongoDB documents (`_id` = natural key,
 * real BSON dates).
 */
import { createAssignment } from '../../../domain/entities/Assignment.js';
import { createAssignmentOverride } from '../../../domain/entities/AssignmentOverride.js';
import { createFlag, createLetter } from '../../../domain/entities/Letter.js';
import { createParticipant } from '../../../domain/entities/Participant.js';
import { createPrintStatus } from '../../../domain/entities/PrintStatus.js';
import { createSyncRun } from '../../../domain/entities/SyncRun.js';
import { createSyncResult } from '../../../domain/entities/SyncResult.js';
import { createSyncState } from '../../../domain/entities/SyncState.js';

/**
 * @param {import('../../../domain/entities/Assignment.js').Assignment} assignment
 */
export function assignmentToDocument(assignment) {
  const a = createAssignment(assignment);
  return {
    participantIds: [...a.participantIds],
    status: a.status,
    signal: a.signal,
    confidence: a.confidence,
    matchedText: a.matchedText,
    suggestedParticipantIds: [...a.suggestedParticipantIds],
    matches: a.matches.map((m) => ({ ...m })),
  };
}

/**
 * @param {ReadonlyArray<import('../../../domain/entities/Letter.js').LetterFlag>} flags
 */
export function flagsToDocument(flags) {
  return flags.map((flag) => ({ ...createFlag(flag) }));
}

/**
 * Fields replaced on every upsert (content, assignment, flags, soft-delete marker).
 * @param {import('../../../domain/entities/Letter.js').Letter} input
 */
export function letterContentFields(input) {
  const letter = createLetter(input);
  return {
    threadId: letter.threadId,
    from: letter.from,
    to: letter.to,
    subject: letter.subject,
    receivedAt: letter.receivedAt,
    cleanBody: letter.cleanBody,
    formattedBody: letter.formattedBody,
    attachments: letter.attachments.map((a) => ({ ...a })),
    assignment: assignmentToDocument(letter.assignment),
    flags: flagsToDocument(letter.flags),
    contentHash: letter.contentHash,
    deletedAt: letter.deletedAt,
  };
}

/**
 * Insert-only novelty fields.
 * @param {import('../../../domain/entities/Letter.js').Letter} letter
 */
export function letterNoveltyFields(letter) {
  return {
    firstSeenAt: letter.firstSeenAt,
    syncRunId: letter.syncRunId,
    seenByStaff: letter.seenByStaff === true,
  };
}

/**
 * @param {Record<string, any>} document
 */
export function letterFromDocument(document) {
  const { _id, ...rest } = document;
  return createLetter({ ...rest, messageId: _id });
}

/**
 * @param {import('../../../domain/entities/Participant.js').Participant} participant
 */
export function participantToDocument(participant) {
  const p = createParticipant(participant);
  return { _id: p.id, displayName: p.displayName, aliases: [...p.aliases] };
}

/**
 * @param {Record<string, any>} document
 */
export function participantFromDocument(document) {
  return createParticipant({ id: document._id, displayName: document.displayName, aliases: document.aliases ?? [] });
}

/**
 * @param {import('../../../domain/entities/PrintStatus.js').PrintStatus} status
 */
export function printStatusToDocument(status) {
  const s = createPrintStatus(status);
  return { _id: s.participantId, status: s.status, printedAt: s.printedAt };
}

/**
 * @param {Record<string, any>} document
 */
export function printStatusFromDocument(document) {
  return createPrintStatus({ participantId: document._id, status: document.status, printedAt: document.printedAt ?? null });
}

/**
 * @param {import('../../../domain/entities/AssignmentOverride.js').AssignmentOverride} override
 */
export function overrideToDocument(override) {
  const o = createAssignmentOverride(override);
  return { _id: o.messageId, participantIds: [...o.participantIds], updatedAt: o.updatedAt };
}

/**
 * @param {Record<string, any>} document
 */
export function overrideFromDocument(document) {
  return createAssignmentOverride({
    messageId: document._id,
    participantIds: document.participantIds ?? [],
    updatedAt: document.updatedAt ?? new Date(0),
  });
}

/**
 * Every persisted sync-state field except `lock` (managed only by acquire/release).
 * @param {import('../../../domain/entities/SyncState.js').SyncState} input
 */
export function syncStateFields(input) {
  const state = createSyncState(input);
  return {
    historyId: state.historyId,
    selectionKey: state.selectionKey,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastFullSyncAt: state.lastFullSyncAt,
    status: state.status,
    lastError: state.lastError,
    lastResult: state.lastResult
      ? {
          ...createSyncResult(state.lastResult),
          perParticipantDeltas: state.lastResult.perParticipantDeltas.map((d) => ({ ...d })),
        }
      : null,
  };
}

/**
 * @param {Record<string, any> | null} document
 */
export function syncStateFromDocument(document) {
  if (!document) return createSyncState();
  const { _id, ...rest } = document;
  return createSyncState({ ...rest, id: _id });
}

/**
 * @param {import('../../../domain/entities/SyncRun.js').SyncRun} input
 */
export function syncRunToDocument(input) {
  const run = createSyncRun(input);
  return {
    _id: run.id,
    type: run.type,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    added: run.added,
    updated: run.updated,
    deleted: run.deleted,
    status: run.status,
    error: run.error,
    durationMs: run.durationMs,
  };
}

/**
 * @param {Record<string, any>} document
 */
export function syncRunFromDocument(document) {
  const { _id, ...rest } = document;
  return createSyncRun({ ...rest, id: _id });
}
