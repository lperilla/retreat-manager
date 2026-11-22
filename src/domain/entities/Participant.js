import { COLLATION_LOCALE } from '../constants.js';
import { AppError } from '../errors.js';

/**
 * How the letters module sees a participant (a projection of the participants module):
 * enough to match letters, count them and print them.
 *
 * @typedef {Object} ParticipantNameParts
 * @property {string}      givenNames     "José Antonio"
 * @property {string}      firstSurname   "García" (may be empty for old single-field names)
 * @property {string|null} secondSurname  "López"
 *
 * @typedef {Object} Participant
 * @property {string}   id          URL-safe slug, unique per retreat.
 * @property {string}   displayName Name shown to staff and on printouts.
 * @property {string[]} aliases     Alternative names (nicknames, short forms).
 * @property {ParticipantNameParts | null} nameParts  Structured name: enables name variants
 *           in matching ("José García" for José Antonio García López). Null = displayName only.
 * @property {'active' | 'withdrawn'} status  Withdrawn participants keep their letters, which
 *           are marked "no está en el retiro" and left out of the dashboard and print batches.
 */

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Builds a URL-safe slug ("María José Núñez" → "maria-jose-nunez").
 * @param {string} value
 * @returns {string}
 */
export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * @param {string} value
 * @returns {string}
 */
function foldForComparison(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} value
 * @returns {string}
 */
function cleanName(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(reason) {
  return new AppError('INVALID_PARTICIPANT', 400, undefined, { reason });
}

/**
 * Creates a validated, immutable participant.
 * @param {{ id?: string, displayName: string, aliases?: string[], nameParts?: ParticipantNameParts | null, status?: string }} props
 * @returns {Participant}
 */
export function createParticipant(props) {
  const { id, displayName, aliases = [], nameParts = null, status = 'active' } = props ?? {};
  const name = typeof displayName === 'string' ? cleanName(displayName) : '';
  if (!name) throw invalid('displayName is required');

  const slug = id === undefined || id === null || id === '' ? slugify(name) : String(id);
  if (!SLUG_PATTERN.test(slug)) throw invalid(`id "${slug}" is not a valid slug`);
  if (!Array.isArray(aliases)) throw invalid('aliases must be an array');

  const seen = new Set([foldForComparison(name)]);
  const cleanAliases = [];
  for (const alias of aliases) {
    if (typeof alias !== 'string') throw invalid('aliases must contain strings only');
    const value = cleanName(alias);
    const key = foldForComparison(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    cleanAliases.push(value);
  }

  if (status !== 'active' && status !== 'withdrawn') throw invalid(`unknown status "${status}"`);
  const parts =
    nameParts && typeof nameParts.givenNames === 'string' && nameParts.givenNames.trim()
      ? Object.freeze({
          givenNames: cleanName(nameParts.givenNames),
          firstSurname: cleanName(String(nameParts.firstSurname ?? '')),
          secondSurname: nameParts.secondSurname ? cleanName(String(nameParts.secondSurname)) : null,
        })
      : null;

  return Object.freeze({ id: slug, displayName: name, aliases: Object.freeze(cleanAliases), nameParts: parts, status });
}

/**
 * Spanish collation, accent/case-insensitive, with a stable tie-break by id.
 * @param {Pick<Participant, 'id' | 'displayName'>} a
 * @param {Pick<Participant, 'id' | 'displayName'>} b
 * @returns {number}
 */
export function compareParticipantsByName(a, b) {
  const byName = a.displayName.localeCompare(b.displayName, COLLATION_LOCALE, { sensitivity: 'base' });
  if (byName !== 0) return byName;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * @template {Pick<Participant, 'id' | 'displayName'>} T
 * @param {readonly T[]} participants
 * @returns {T[]}
 */
export function sortParticipantsByName(participants) {
  return [...participants].sort(compareParticipantsByName);
}

/**
 * @param {Pick<Participant, 'status'> | null | undefined} participant
 * @returns {boolean}
 */
export function isParticipantActive(participant) {
  return Boolean(participant) && participant?.status !== 'withdrawn';
}

/**
 * @param {readonly Participant[]} participants
 * @returns {Map<string, Participant>}
 */
export function indexParticipantsById(participants) {
  return new Map(participants.map((participant) => [participant.id, participant]));
}

/**
 * Throws `DUPLICATE_PARTICIPANT` when two participants share an id.
 * @param {readonly Participant[]} participants
 * @returns {readonly Participant[]}
 */
export function assertUniqueParticipantIds(participants) {
  const seen = new Set();
  for (const participant of participants) {
    if (seen.has(participant.id)) {
      throw new AppError('DUPLICATE_PARTICIPANT', 409, undefined, { participantId: participant.id });
    }
    seen.add(participant.id);
  }
  return participants;
}
