import { isLetterPrinted } from '../entities/PrintStatus.js';

/**
 * Gmail label name of a participant: "<prefix>/<display name>" (nested under the prefix), or just
 * the display name when the optional prefix is empty.
 * Characters Gmail rejects or that would create extra nesting are replaced by spaces.
 * @param {string} prefix
 * @param {{ id: string, displayName: string }} participant
 * @returns {string}
 */
export function participantLabelName(prefix, participant) {
  const name = String(participant.displayName ?? '')
    .replace(/[\\/,\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = name || participant.id;
  return (prefix ? `${prefix}/${base}` : base).slice(0, 200);
}

/**
 * Labels a letter should carry in Gmail, from the local database (the source of truth).
 * Only assigned letters get participant labels; the printed label requires every
 * participant of the letter to have it printed.
 * @param {{
 *   letter: import('../entities/Letter.js').Letter,
 *   participantsById: ReadonlyMap<string, { id: string, displayName: string }>,
 *   printStatusById: ReadonlyMap<string, import('../entities/PrintStatus.js').PrintStatus>,
 *   prefix: string,
 * }} input
 * @returns {{ labels: string[], printed: boolean }}
 */
export function desiredLabels({ letter, participantsById, printStatusById, prefix }) {
  const participants = letter.assignment.participantIds
    .map((id) => participantsById.get(id))
    .filter((participant) => participant !== undefined);
  const labels = [...new Set(participants.map((participant) => participantLabelName(prefix, participant)))].sort();
  const printed =
    participants.length > 0 && participants.every((participant) => isLetterPrinted(printStatusById.get(participant.id), letter));
  return { labels, printed };
}
