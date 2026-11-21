/**
 * Counting rules:
 * - total letters, participants with >= 1 letter, participants with 0;
 * - "most" and "fewest" return ALL tied participants; "fewest" includes 0-letter participants;
 * - soft-deleted letters are excluded from every count;
 * - NEEDS_REVIEW / UNASSIGNED letters count for nobody (but are part of the total);
 * - letters are deduplicated by messageId.
 */
import { AssignmentStatus } from '../constants.js';
import { compareParticipantsByName } from '../entities/Participant.js';
import {
  assignedParticipantIds,
  hasWarningFlags,
  isLetterActive,
  isNewLetter,
} from '../entities/Letter.js';
import { createRetreatSummary } from '../entities/RetreatSummary.js';

/**
 * Active letters, deduplicated by messageId (the last occurrence wins).
 * @template {import('../entities/Letter.js').Letter} T
 * @param {readonly T[]} letters
 * @returns {T[]}
 */
export function activeUniqueLetters(letters) {
  /** @type {Map<string, T>} */
  const byId = new Map();
  for (const letter of letters) byId.set(letter.messageId, letter);
  return [...byId.values()].filter(isLetterActive);
}

/**
 * Per-participant counters, sorted alphabetically (Spanish collation).
 * Letters assigned to unknown participant ids are ignored here.
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @param {readonly import('../entities/Letter.js').Letter[]} letters
 * @returns {import('../entities/RetreatSummary.js').ParticipantStats[]}
 */
export function computeParticipantStats(participants, letters) {
  /** @type {Map<string, import('../entities/RetreatSummary.js').ParticipantStats>} */
  const stats = new Map();
  for (const participant of participants) {
    stats.set(participant.id, {
      participantId: participant.id,
      displayName: participant.displayName,
      letterCount: 0,
      newCount: 0,
      warningCount: 0,
    });
  }
  for (const letter of activeUniqueLetters(letters)) {
    const isNew = isNewLetter(letter);
    const warned = hasWarningFlags(letter);
    for (const participantId of new Set(assignedParticipantIds(letter))) {
      const entry = stats.get(participantId);
      if (!entry) continue;
      entry.letterCount += 1;
      if (isNew) entry.newCount += 1;
      if (warned) entry.warningCount += 1;
    }
  }
  return [...stats.values()].sort((a, b) =>
    compareParticipantsByName(
      { id: a.participantId, displayName: a.displayName },
      { id: b.participantId, displayName: b.displayName },
    ),
  );
}

/**
 * @param {readonly import('../entities/RetreatSummary.js').ParticipantStats[]} stats  Sorted alphabetically.
 * @param {'max' | 'min'} mode
 * @returns {import('../entities/RetreatSummary.js').TieGroup}
 */
function tiedAt(stats, mode) {
  if (stats.length === 0) return { count: 0, participantIds: [] };
  const counts = stats.map((s) => s.letterCount);
  const target = mode === 'max' ? Math.max(...counts) : Math.min(...counts);
  if (mode === 'max' && target === 0) return { count: 0, participantIds: [] };
  return { count: target, participantIds: stats.filter((s) => s.letterCount === target).map((s) => s.participantId) };
}

/**
 * Builds the dashboard summary.
 * @param {{
 *   participants: readonly import('../entities/Participant.js').Participant[],
 *   letters: readonly import('../entities/Letter.js').Letter[],
 *   lastSyncAt?: Date | null,
 *   syncStatus?: string | null,
 * }} input
 * @returns {Readonly<import('../entities/RetreatSummary.js').RetreatSummary>}
 */
export function summarizeRetreat({ participants, letters, lastSyncAt = null, syncStatus = null }) {
  const active = activeUniqueLetters(letters);
  const perParticipant = computeParticipantStats(participants, active);
  const zeroLetterParticipantIds = perParticipant.filter((s) => s.letterCount === 0).map((s) => s.participantId);

  return createRetreatSummary({
    totalLetters: active.length,
    participantCount: perParticipant.length,
    participantsWithLetters: perParticipant.length - zeroLetterParticipantIds.length,
    participantsWithoutLetters: zeroLetterParticipantIds.length,
    mostLetters: tiedAt(perParticipant, 'max'),
    fewestLetters: tiedAt(perParticipant, 'min'),
    zeroLetterParticipantIds,
    reviewQueueSize: active.filter((l) => l.assignment.status === AssignmentStatus.NEEDS_REVIEW).length,
    unassignedCount: active.filter((l) => l.assignment.status === AssignmentStatus.UNASSIGNED).length,
    newLettersCount: active.filter(isNewLetter).length,
    flaggedLettersCount: active.filter(hasWarningFlags).length,
    perParticipant,
    lastSyncAt,
    syncStatus,
  });
}

/**
 * Directory sort: by letter count (descending) or alphabetically, both stable.
 * @param {readonly import('../entities/RetreatSummary.js').ParticipantStats[]} stats
 * @param {'count' | 'name'} [sortBy]
 * @returns {import('../entities/RetreatSummary.js').ParticipantStats[]}
 */
export function sortParticipantStats(stats, sortBy = 'name') {
  const byName = (
    /** @type {import('../entities/RetreatSummary.js').ParticipantStats} */ a,
    /** @type {import('../entities/RetreatSummary.js').ParticipantStats} */ b,
  ) =>
    compareParticipantsByName(
      { id: a.participantId, displayName: a.displayName },
      { id: b.participantId, displayName: b.displayName },
    );
  if (sortBy === 'count') return [...stats].sort((a, b) => b.letterCount - a.letterCount || byName(a, b));
  return [...stats].sort(byName);
}
