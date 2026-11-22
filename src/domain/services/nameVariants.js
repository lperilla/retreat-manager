/**
 * Name variants of a participant with a structured name, used as extra keys of the
 * existing matching index (so "José García", "Jose Antonio Garcia", "José A. García" and
 * "Jose Garcia Lopez" all point to José Antonio García López).
 *
 * The matching engine is unchanged: variants are exact keys after normalization, the longest
 * key wins, and a key shared by two participants is ambiguous (the letter goes to review).
 * Bare first names are NOT produced here (the index already has them as kind "first").
 */
import { normalizeText } from './text.js';

/**
 * @param {string} value
 * @returns {string[]}
 */
function words(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

/**
 * Hyphenated surnames are also written with a space ("garcia-lopez" / "garcia lopez").
 * @param {string} surname  Normalized.
 * @returns {string[]}
 */
function surnameForms(surname) {
  if (!surname) return [];
  const forms = new Set([surname]);
  if (surname.includes('-')) forms.add(surname.replace(/-/g, ' '));
  return [...forms];
}

/**
 * @param {import('../entities/Participant.js').ParticipantNameParts | null | undefined} nameParts
 * @returns {string[]}  Normalized variant keys (2+ words), without duplicates.
 */
export function nameVariants(nameParts) {
  if (!nameParts || !nameParts.givenNames) return [];
  const given = words(nameParts.givenNames);
  const first = surnameForms(normalizeText(nameParts.firstSurname ?? ''));
  const second = surnameForms(normalizeText(nameParts.secondSurname ?? ''));
  if (given.length === 0 || first.length === 0) return [];

  const g1 = given[0];
  const allGiven = given.join(' ');
  /** @type {string[]} */
  const givenForms = [g1, allGiven];
  if (given.length > 1) {
    const initials = given.slice(1).map((word) => word[0]);
    givenForms.push(`${g1} ${initials.join(' ')}`, `${g1} ${initials.map((i) => `${i}.`).join(' ')}`);
  }

  const variants = new Set();
  for (const g of givenForms) {
    for (const s1 of first) {
      variants.add(`${g} ${s1}`);
      for (const s2 of second) variants.add(`${g} ${s1} ${s2}`);
    }
  }
  return [...variants].filter((variant) => variant.includes(' '));
}

/**
 * Every normalized word of a participant's names and aliases (used to tell a surname that
 * belongs to the participant from one that contradicts the match).
 * @param {Pick<import('../entities/Participant.js').Participant, 'displayName' | 'aliases' | 'nameParts'>} participant
 * @returns {Set<string>}
 */
export function nameTokens(participant) {
  const tokens = new Set();
  const add = (/** @type {string} */ value) => {
    for (const word of words(value)) {
      tokens.add(word);
      for (const piece of word.split(/[-.']/)) if (piece) tokens.add(piece);
    }
  };
  add(participant.displayName);
  for (const alias of participant.aliases ?? []) add(alias);
  if (participant.nameParts) {
    add(participant.nameParts.givenNames);
    add(participant.nameParts.firstSurname ?? '');
    add(participant.nameParts.secondSurname ?? '');
  }
  return tokens;
}
