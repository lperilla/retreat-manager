/**
 * Plain, JSON-serializable views shared by the web adapters.
 * Dates are ISO-8601 strings; participant ids are resolved to display names.
 */
import { AssignmentStatus, SignalType } from '../../domain/constants.js';
import { isNewLetter } from '../../domain/entities/Letter.js';
import { classifyAttachment, isInlineImage } from '../../domain/services/attachments.js';

/**
 * @param {Date | null | undefined} date
 * @returns {string | null}
 */
export function toIso(date) {
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

/**
 * @param {Map<string, import('../../domain/entities/Participant.js').Participant>} participantsById
 * @param {string} participantId
 * @returns {{ id: string, displayName: string, known: boolean }}
 */
export function presentParticipantRef(participantsById, participantId) {
  const participant = participantsById.get(participantId);
  return { id: participantId, displayName: participant?.displayName ?? participantId, known: Boolean(participant) };
}

/**
 * @param {import('../../domain/entities/Letter.js').Letter} letter
 * @param {{ participantsById: Map<string, import('../../domain/entities/Participant.js').Participant>, includeBody?: boolean }} context
 */
export function presentLetter(letter, { participantsById, includeBody = true }) {
  const { assignment } = letter;
  const view = {
    messageId: letter.messageId,
    threadId: letter.threadId,
    from: letter.from,
    to: letter.to,
    subject: letter.subject,
    receivedAt: toIso(letter.receivedAt),
    attachments: letter.attachments.map((a, index) => ({
      index,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      contentId: a.contentId,
      kind: classifyAttachment(a),
      inline: isInlineImage(a),
    })),
    assignment: {
      status: assignment.status,
      participants: assignment.participantIds.map((id) => presentParticipantRef(participantsById, id)),
      signal: assignment.signal,
      confidence: assignment.confidence,
      matchedText: assignment.matchedText,
      manual: assignment.signal === SignalType.MANUAL,
      suggestions:
        assignment.status === AssignmentStatus.ASSIGNED
          ? []
          : assignment.suggestedParticipantIds.map((id) => {
              const match = assignment.matches.find((m) => m.participantId === id);
              return {
                ...presentParticipantRef(participantsById, id),
                signal: match?.signal ?? null,
                confidence: match?.confidence ?? 0,
                matchedText: match?.matchedText ?? '',
              };
            }),
    },
    flags: letter.flags.map((f) => ({ type: f.type, confidence: f.confidence, reason: f.reason })),
    isNew: isNewLetter(letter),
    seenByStaff: letter.seenByStaff,
    firstSeenAt: toIso(letter.firstSeenAt),
    deletedAt: toIso(letter.deletedAt),
  };
  return includeBody ? { ...view, body: letter.cleanBody } : view;
}

/**
 * @param {import('../../domain/entities/SyncResult.js').SyncResult | null} result
 * @param {Map<string, import('../../domain/entities/Participant.js').Participant>} [participantsById]
 */
export function presentSyncResult(result, participantsById = new Map()) {
  if (!result) return null;
  return {
    mode: result.mode,
    requestedMode: result.requestedMode,
    fallbackToFull: result.fallbackToFull,
    fullSyncReason: result.fullSyncReason,
    added: result.added,
    updated: result.updated,
    unchanged: result.unchanged,
    deleted: result.deleted,
    perParticipantDeltas: result.perParticipantDeltas.map((d) => ({
      ...presentParticipantRef(participantsById, d.participantId),
      participantId: d.participantId,
      newLetters: d.newLetters,
    })),
    durationMs: result.durationMs,
    syncRunId: result.syncRunId,
  };
}

/**
 * @param {import('../../domain/entities/SyncRun.js').SyncRun} run
 */
export function presentSyncRun(run) {
  return {
    id: run.id,
    type: run.type,
    status: run.status,
    startedAt: toIso(run.startedAt),
    finishedAt: toIso(run.finishedAt),
    durationMs: run.durationMs,
    added: run.added,
    updated: run.updated,
    deleted: run.deleted,
    error: run.error,
  };
}

/**
 * @param {string} participantId
 * @param {import('../../domain/entities/PrintStatus.js').PrintStatus | null | undefined} status
 */
export function presentPrintStatus(participantId, status) {
  return {
    participantId,
    status: status?.status ?? 'pending',
    printedAt: toIso(status?.printedAt),
  };
}
