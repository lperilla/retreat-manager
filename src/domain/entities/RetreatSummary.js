/**
 * Per-participant counters.
 * @typedef {Object} ParticipantStats
 * @property {string} participantId
 * @property {string} displayName
 * @property {number} letterCount   Active letters assigned to the participant.
 * @property {number} newCount      Of those, letters not yet seen by staff.
 * @property {number} warningCount  Of those, letters carrying a warning flag.
 */

/**
 * Participants tied at an extreme. `participantIds` lists ALL tied participants.
 * @typedef {Object} TieGroup
 * @property {number}   count
 * @property {string[]} participantIds
 */

/**
 * @typedef {Object} RetreatSummary
 * @property {number}             totalLetters               Active letters received (each letter once).
 * @property {number}             participantCount
 * @property {number}             participantsWithLetters
 * @property {number}             participantsWithoutLetters
 * @property {TieGroup}           mostLetters                Empty `participantIds` when nobody has letters.
 * @property {TieGroup}           fewestLetters              Includes 0-letter participants.
 * @property {string[]}           zeroLetterParticipantIds
 * @property {number}             reviewQueueSize            Active NEEDS_REVIEW letters.
 * @property {number}             unassignedCount            Active letters explicitly left unassigned.
 * @property {number}             newLettersCount            Active letters not seen by staff.
 * @property {number}             flaggedLettersCount        Active letters carrying a warning flag.
 * @property {ParticipantStats[]} perParticipant             Sorted alphabetically (Spanish collation).
 * @property {Date|null}          lastSyncAt
 * @property {string|null}        syncStatus
 */

/**
 * @param {TieGroup | undefined} group
 * @returns {Readonly<TieGroup>}
 */
function freezeTie(group) {
  return Object.freeze({
    count: group?.count ?? 0,
    participantIds: Object.freeze([...(group?.participantIds ?? [])]),
  });
}

/**
 * @param {Partial<RetreatSummary>} props
 * @returns {Readonly<RetreatSummary>}
 */
export function createRetreatSummary(props) {
  const source = props ?? {};
  return Object.freeze({
    totalLetters: source.totalLetters ?? 0,
    participantCount: source.participantCount ?? 0,
    participantsWithLetters: source.participantsWithLetters ?? 0,
    participantsWithoutLetters: source.participantsWithoutLetters ?? 0,
    mostLetters: freezeTie(source.mostLetters),
    fewestLetters: freezeTie(source.fewestLetters),
    zeroLetterParticipantIds: Object.freeze([...(source.zeroLetterParticipantIds ?? [])]),
    reviewQueueSize: source.reviewQueueSize ?? 0,
    unassignedCount: source.unassignedCount ?? 0,
    newLettersCount: source.newLettersCount ?? 0,
    flaggedLettersCount: source.flaggedLettersCount ?? 0,
    perParticipant: Object.freeze((source.perParticipant ?? []).map((stats) => Object.freeze({ ...stats }))),
    lastSyncAt: source.lastSyncAt ?? null,
    syncStatus: source.syncStatus ?? null,
  });
}
