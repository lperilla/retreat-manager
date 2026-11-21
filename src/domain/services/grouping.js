/**
 * Chronological grouping: ascending `receivedAt`, stable tie-break by `messageId`.
 * The optional `afterDate` filter is EXCLUSIVE and evaluated in the configured time zone.
 */
import { DEFAULTS } from '../constants.js';
import { isAssignedTo, isLetterActive } from '../entities/Letter.js';
import { activeUniqueLetters } from './counting.js';
import { assertTimeZone, isAfterCriterion, parseAfterDate, toZonedDateKey } from './time.js';

/**
 * @param {Pick<import('../entities/Letter.js').Letter, 'receivedAt' | 'messageId'>} a
 * @param {Pick<import('../entities/Letter.js').Letter, 'receivedAt' | 'messageId'>} b
 * @returns {number}
 */
export function compareLettersChronologically(a, b) {
  const diff = a.receivedAt.getTime() - b.receivedAt.getTime();
  if (diff !== 0) return diff;
  if (a.messageId < b.messageId) return -1;
  if (a.messageId > b.messageId) return 1;
  return 0;
}

/**
 * @template {import('../entities/Letter.js').Letter} T
 * @param {readonly T[]} letters
 * @returns {T[]}
 */
export function sortChronologically(letters) {
  return [...letters].sort(compareLettersChronologically);
}

/**
 * @template {import('../entities/Letter.js').Letter} T
 * @param {readonly T[]} letters
 * @param {string | Date | null | undefined} afterDate
 * @param {string} [timeZone]
 * @returns {T[]}
 */
export function filterAfterDate(letters, afterDate, timeZone = DEFAULTS.TIME_ZONE) {
  const criterion = parseAfterDate(afterDate, timeZone);
  if (!criterion) return [...letters];
  return letters.filter((letter) => isAfterCriterion(letter.receivedAt, criterion, timeZone));
}

/**
 * Active letters of one participant, in chronological order.
 * @template {import('../entities/Letter.js').Letter} T
 * @param {readonly T[]} letters
 * @param {string} participantId
 * @param {{ afterDate?: string | Date | null, timeZone?: string }} [options]
 * @returns {T[]}
 */
export function groupParticipantLetters(letters, participantId, { afterDate = null, timeZone = DEFAULTS.TIME_ZONE } = {}) {
  assertTimeZone(timeZone);
  const own = activeUniqueLetters(letters).filter((letter) => isAssignedTo(letter, participantId));
  return sortChronologically(filterAfterDate(own, afterDate, timeZone));
}

/**
 * Chronological letters per participant id (multi-recipient letters appear under each).
 * @template {import('../entities/Letter.js').Letter} T
 * @param {readonly T[]} letters
 * @param {readonly string[]} participantIds
 * @param {{ afterDate?: string | Date | null, timeZone?: string }} [options]
 * @returns {Map<string, T[]>}
 */
export function groupLettersByParticipant(letters, participantIds, options = {}) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const participantId of participantIds) {
    groups.set(participantId, groupParticipantLetters(letters, participantId, options));
  }
  return groups;
}

/**
 * Splits chronological letters by local calendar day (useful for day headings).
 * @template {import('../entities/Letter.js').Letter} T
 * @param {readonly T[]} letters
 * @param {string} [timeZone]
 * @returns {Array<{ dateKey: string, letters: T[] }>}
 */
export function groupLettersByLocalDay(letters, timeZone = DEFAULTS.TIME_ZONE) {
  assertTimeZone(timeZone);
  /** @type {Array<{ dateKey: string, letters: T[] }>} */
  const days = [];
  for (const letter of sortChronologically(letters.filter(isLetterActive))) {
    const dateKey = toZonedDateKey(letter.receivedAt, timeZone);
    const last = days[days.length - 1];
    if (last && last.dateKey === dateKey) last.letters.push(letter);
    else days.push({ dateKey, letters: [letter] });
  }
  return days;
}
