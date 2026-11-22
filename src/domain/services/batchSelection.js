/**
 * Batch selection helpers ("Seleccionar todos", "con cartas", "pendientes de imprimir")
 * and the builder of the renderer-agnostic batch export payload.
 */
import { DEFAULTS } from '../constants.js';
import { createBatchExportPayload } from '../entities/BatchExportPayload.js';
import { compareParticipantsByName, sortParticipantsByName } from '../entities/Participant.js';
import { isPendingPrint } from '../entities/PrintStatus.js';
import { AppError } from '../errors.js';
import { groupParticipantLetters } from './grouping.js';

/**
 * @typedef {Map<string, number> | Record<string, number> | ReadonlyArray<{ participantId: string, letterCount: number }>} LetterCounts
 */

/**
 * @param {LetterCounts | null | undefined} counts
 * @returns {Map<string, number>}
 */
function toCountMap(counts) {
  if (!counts) return new Map();
  if (counts instanceof Map) return counts;
  if (Array.isArray(counts)) return new Map(counts.map((c) => [c.participantId, c.letterCount]));
  return new Map(Object.entries(counts));
}

/**
 * @param {Map<string, import('../entities/PrintStatus.js').PrintStatus> | ReadonlyArray<import('../entities/PrintStatus.js').PrintStatus> | null | undefined} statuses
 * @returns {Map<string, import('../entities/PrintStatus.js').PrintStatus>}
 */
function toStatusMap(statuses) {
  if (!statuses) return new Map();
  if (statuses instanceof Map) return statuses;
  return new Map(statuses.map((s) => [s.participantId, s]));
}

/**
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @returns {string[]}
 */
export function selectAllParticipants(participants) {
  return sortParticipantsByName(participants).map((p) => p.id);
}

/**
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @param {LetterCounts} letterCounts
 * @returns {string[]}
 */
export function selectParticipantsWithLetters(participants, letterCounts) {
  const counts = toCountMap(letterCounts);
  return sortParticipantsByName(participants)
    .filter((p) => (counts.get(p.id) ?? 0) > 0)
    .map((p) => p.id);
}

/**
 * Participants without a stored print status count as pending.
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @param {Map<string, import('../entities/PrintStatus.js').PrintStatus> | ReadonlyArray<import('../entities/PrintStatus.js').PrintStatus>} printStatuses
 * @returns {string[]}
 */
export function selectParticipantsPendingPrint(participants, printStatuses) {
  const statuses = toStatusMap(printStatuses);
  return sortParticipantsByName(participants)
    .filter((p) => isPendingPrint(statuses.get(p.id)))
    .map((p) => p.id);
}

/**
 * Validates a requested selection: non-empty, known ids only. Returns ids deduplicated
 * and sorted alphabetically by display name.
 * @param {readonly string[]} requestedIds
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @returns {string[]}
 */
export function resolveSelection(requestedIds, participants) {
  if (!Array.isArray(requestedIds) || requestedIds.length === 0) {
    throw new AppError('EMPTY_SELECTION', 400);
  }
  const byId = new Map(participants.map((p) => [p.id, p]));
  const unique = [...new Set(requestedIds)];
  const missing = unique.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new AppError('PARTICIPANT_NOT_FOUND', 404, undefined, { participantIds: missing });
  }
  return unique
    .map((id) => /** @type {import('../entities/Participant.js').Participant} */ (byId.get(id)))
    .sort(compareParticipantsByName)
    .map((p) => p.id);
}

/**
 * Builds the batch export payload: one section per selected participant (alphabetical),
 * letters in chronological order. Participants with 0 letters get an empty section.
 * @param {{
 *   participants: readonly import('../entities/Participant.js').Participant[],
 *   letters: readonly import('../entities/Letter.js').Letter[],
 *   participantIds: readonly string[],
 *   generatedAt: Date,
 *   timeZone?: string,
 *   afterDate?: string | Date | null,
 *   includeLetter?: ((letter: import('../entities/Letter.js').Letter, participantId: string) => boolean) | null,
 * }} input
 * @returns {Readonly<import('../entities/BatchExportPayload.js').BatchExportPayload>}
 */
export function buildBatchExportPayload({
  participants,
  letters,
  participantIds,
  generatedAt,
  timeZone = DEFAULTS.TIME_ZONE,
  afterDate = null,
  includeLetter = null,
}) {
  const selected = resolveSelection(participantIds, participants);
  const byId = new Map(participants.map((p) => [p.id, p]));
  const sections = selected.map((id) => {
    const participant = /** @type {import('../entities/Participant.js').Participant} */ (byId.get(id));
    return {
      participant: { id: participant.id, displayName: participant.displayName },
      letters: groupParticipantLetters(letters, id, { afterDate, timeZone }).filter((letter) => !includeLetter || includeLetter(letter, id)),
      letterCount: 0,
    };
  });
  return createBatchExportPayload({ generatedAt, timeZone, sections });
}
