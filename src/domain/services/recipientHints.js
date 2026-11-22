/**
 * Recipient hints: the name written after "Carta para", "Para:", "Querido…", "Hola…" or on
 * a salutation line, even when it matches no registered participant ("Carta para Luis
 * Perila"). Used to show "Destinatario detectado" in the review queue and to suggest the
 * participants whose name is SIMILAR (typos). Similar names are only suggestions: the
 * matching engine never assigns a letter because of them.
 */
import { normalizeText, stripSubjectPrefixes } from './text.js';

const MAX_WORDS = 5;
const MAX_HINTS = 3;
/** Lower-case words allowed inside a name ("José de la Fuente"). */
const NAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'san']);
/** Words after a trigger that are not names ("Para mi querido…", "Hola a todos"). */
const NOT_NAMES = new Set([
  'mi', 'mis', 'tu', 'su', 'nuestro', 'nuestra', 'el', 'la', 'los', 'las', 'todos', 'todas', 'a', 'querido', 'querida', 'ti', 'vosotros',
  'hola', 'buenos', 'buenas', 'dias', 'tardes', 'noches', 'estimado', 'estimada', 'estimados', 'carta', 'para',
  'amigo', 'amiga', 'hermano', 'hermana', 'hijo', 'hija', 'nieto', 'nieta', 'sobrino', 'sobrina', 'primo', 'prima', 'ahijado', 'ahijada', 'papa', 'mama',
]);
const TRIGGER = /(?:^|[^\p{L}])(carta\s+para|para\s*:|para|querid[oa]s?|queridísim[oa]s?|hola)[\s,:]+/giu;
const WORD = /^[\p{L}][\p{L}'’.-]*/u;

/**
 * Capitalized words after `start` (and lower-case particles between them).
 * @param {string} text
 * @param {number} start
 * @returns {string | null}
 */
function nameAt(text, start) {
  const words = [];
  let rest = text.slice(start);
  while (words.length < MAX_WORDS) {
    const match = WORD.exec(rest);
    if (!match) break;
    const word = match[0];
    const isCapital = word[0] !== word[0].toLowerCase();
    if (isCapital && !NOT_NAMES.has(normalizeText(word))) words.push(word);
    else if (words.length > 0 && NAME_PARTICLES.has(word.toLowerCase())) words.push(word);
    else if (words.length === 0 && NOT_NAMES.has(normalizeText(word))) {
      // "Para mi querido Juan": skip the filler and keep looking.
    } else break;
    rest = rest.slice(word.length);
    const gap = /^[ \t]+/.exec(rest);
    if (!gap) break;
    rest = rest.slice(gap[0].length);
  }
  while (words.length > 0 && NAME_PARTICLES.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.length > 0 ? words.join(' ').replace(/[.,:;]+$/, '') : null;
}

/**
 * @param {{ subject?: string, body?: string, bodyScanChars?: number }} input
 * @returns {string[]}  Up to three names as written, without duplicates.
 */
export function detectRecipientHints({ subject = '', body = '', bodyScanChars = 600 }) {
  const hints = [];
  const add = (/** @type {string | null} */ name) => {
    if (!name) return;
    for (const part of name.split(/\s*(?:,|\by\b|&)\s*/u)) {
      const clean = part.trim();
      if (clean && !hints.some((h) => normalizeText(h) === normalizeText(clean))) hints.push(clean);
    }
  };
  const scan = (/** @type {string} */ text) => {
    for (const match of text.matchAll(TRIGGER)) add(nameAt(text, /** @type {number} */ (match.index) + match[0].length));
  };
  scan(stripSubjectPrefixes(subject));
  const head = body.slice(0, bodyScanChars);
  scan(head);
  // Salutation lines that are just a name: "Luis:" / "Luis Perilla,"
  for (const line of head.split('\n').slice(0, 5)) {
    const match = /^\s*([\p{Lu}][\p{L}'’-]*(?:\s+[\p{L}'’-]+){0,4})\s*[:,]\s*$/u.exec(line);
    if (match) add(nameAt(match[1], 0));
  }
  return hints.slice(0, MAX_HINTS);
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}  Levenshtein distance.
 */
function distance(a, b) {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function tokens(value) {
  return normalizeText(value)
    .split(/[\s.'’-]+/)
    .filter((t) => t.length >= 2 && !NAME_PARTICLES.has(t));
}

/** Minimum average similarity of the hint's words to call a participant "similar". */
export const SIMILARITY_THRESHOLD = 0.8;
const SINGLE_WORD_THRESHOLD = 0.85;

/**
 * How similar a written name is to a participant (0..1): every written word is compared
 * with the participant's closest name word (Levenshtein, relative to length).
 * @param {string} hint
 * @param {Pick<import('../entities/Participant.js').Participant, 'displayName' | 'aliases' | 'nameParts'>} participant
 * @returns {number}
 */
export function nameSimilarity(hint, participant) {
  const written = tokens(hint);
  if (written.length === 0) return 0;
  const own = new Set([
    ...tokens(participant.displayName),
    ...(participant.aliases ?? []).flatMap(tokens),
    ...(participant.nameParts ? tokens(`${participant.nameParts.givenNames} ${participant.nameParts.firstSurname ?? ''} ${participant.nameParts.secondSurname ?? ''}`) : []),
  ]);
  if (own.size === 0) return 0;
  let total = 0;
  for (const word of written) {
    let best = 0;
    for (const candidate of own) best = Math.max(best, 1 - distance(word, candidate) / Math.max(word.length, candidate.length));
    // A word with no reasonable counterpart (other name entirely) rules the participant out.
    if (best < 0.6) return 0;
    total += best;
  }
  return total / written.length;
}

/**
 * Participants whose name is similar to a written name, most similar first.
 * @param {string} hint
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @returns {Array<{ participantId: string, score: number }>}
 */
export function similarParticipants(hint, participants) {
  // A single written word ("María") is easily close to another name ("Marta"): stricter.
  const threshold = tokens(hint).length > 1 ? SIMILARITY_THRESHOLD : SINGLE_WORD_THRESHOLD;
  const scored = participants
    .map((p) => ({ participantId: p.id, score: nameSimilarity(hint, p) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score || (a.participantId < b.participantId ? -1 : 1));
  // When the name matches someone exactly, merely similar names are noise.
  return scored.length > 0 && scored[0].score === 1 ? scored.filter((s) => s.score === 1) : scored;
}
