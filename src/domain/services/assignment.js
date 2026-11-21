/**
 * ContentAssignmentStrategy: decides which participant(s) a letter is for, using ONLY the
 * subject and the body. The sender name and the signature are never recipient signals
 * (letters are written by relatives).
 *
 * Pipeline:
 *   1. Clean the body (remove quoted replies and signatures) and normalize.
 *   2. Extract signals: SUBJECT_EXPLICIT (0.95), BODY_EXPLICIT (0.85, first N chars),
 *      NAME_MENTION (0.30, full name or alias elsewhere in the body).
 *   3. Decide: multi-recipient, auto-assign, or NEEDS_REVIEW with ranked suggestions.
 */
import { AssignmentStatus, DEFAULTS, EXPLICIT_SIGNALS, SIGNAL_CONFIDENCE, SignalType } from '../constants.js';
import { createAssignment } from '../entities/Assignment.js';
import { AppError } from '../errors.js';
import {
  cleanForAnalysis,
  isWordChar,
  normalizeText,
  normalizeWithMap,
  sliceOriginal,
  stripSubjectPrefixes,
} from './text.js';

/**
 * @typedef {Object} AssignmentSignal
 * @property {string}      participantId
 * @property {string}      signal        One of SignalType.
 * @property {number}      confidence
 * @property {string}      matchedText   Original fragment (trigger + name).
 * @property {boolean}     ambiguous     True when the matched name belongs to 2+ participants.
 * @property {string|null} groupId       Groups the signals produced by one ambiguous occurrence.
 */

/**
 * @typedef {Object} IndexEntry
 * @property {string}              key            Normalized name.
 * @property {string[]}            participantIds Owners of the key (sorted).
 * @property {Map<string, string>} kinds          participantId → 'full' | 'alias' | 'first'.
 * @property {boolean}             ambiguous
 */

/** @typedef {{ entries: IndexEntry[] }} ParticipantIndex */

/** @typedef {{ entry: IndexEntry, start: number, end: number }} NameMatch */

const EPSILON = 1e-9;
const MAX_FILLERS = 3;
const MAX_CHAINED_NAMES = 6;
const KIND_RANK = Object.freeze({ first: 1, alias: 2, full: 3 });

/** Words allowed between a trigger and a name ("para mi querido nieto Juan"). */
const FILLER_WORDS = new Set([
  'mi', 'mis', 'tu', 'su', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
  'el', 'la', 'los', 'las',
  'querido', 'querida', 'queridos', 'queridas', 'queridisimo', 'queridisima',
  'amigo', 'amiga', 'hermano', 'hermana', 'hijo', 'hija', 'nieto', 'nieta',
  'sobrino', 'sobrina', 'primo', 'prima', 'ahijado', 'ahijada',
]);

const SUBJECT_TRIGGERS = Object.freeze([
  // "Carta para X", "Para: X", "[Para: X]", "para X"
  /\b(?:carta[ \t]+)?para\b[ \t]*:?[ \t]*/gu,
  // "Querido X", "Mi querida X", "Hola querido X"
  /\b(?:hola[ \t]*,?[ \t]+)?(?:mi[ \t]+)?(?:querid[oa]s?|queridisim[oa]s?)[ \t]+/gu,
  // "Hola X"
  /\bhola[ \t]*,?[ \t]*/gu,
]);

const BODY_TRIGGERS = Object.freeze([
  /\bcarta[ \t]+para\b[ \t]*:?[ \t]*/gu,
  /\bpara[ \t]*:[ \t]*/gu,
  /\b(?:hola[ \t]*,?[ \t]+)?(?:mi[ \t]+)?(?:querid[oa]s?|queridisim[oa]s?)[ \t]+/gu,
  /\bhola[ \t]*,?[ \t]*/gu,
]);

/** Optional greeting words before a name on a salutation line ("Buenos días Juan,"). */
const GREETING_PREFIX =
  /^(?:(?:hola|querid[oa]s?|queridisim[oa]s?|mi|mis|estimad[oa]s?|buen[oa]s|dias|tardes|noches|para)[ \t,]+)*/u;
/** A salutation line ends in a colon or comma (optionally followed by emojis/punctuation). */
const SALUTATION_END = /^[ \t]*[:,][^\p{L}\p{N}]*$/u;
const NAME_SEPARATOR = /^[ \t]*(?:,[ \t]*(?:y[ \t]+|e[ \t]+)?|y[ \t]+|e[ \t]+|&[ \t]*)/u;

// ---------------------------------------------------------------------------
// Participant index
// ---------------------------------------------------------------------------

/**
 * Builds the matching index: full display names, aliases and bare first names.
 * A key owned by 2+ participants is ambiguous.
 * @param {readonly import('../entities/Participant.js').Participant[]} participants
 * @returns {ParticipantIndex}
 */
export function buildParticipantIndex(participants) {
  /** @type {Map<string, Map<string, string>>} */
  const owners = new Map();

  /**
   * @param {string} key
   * @param {string} participantId
   * @param {'full' | 'alias' | 'first'} kind
   */
  const add = (key, participantId, kind) => {
    if (key.length < 2) return;
    let keyOwners = owners.get(key);
    if (!keyOwners) {
      keyOwners = new Map();
      owners.set(key, keyOwners);
    }
    const current = keyOwners.get(participantId);
    if (!current || KIND_RANK[kind] > KIND_RANK[/** @type {'full'|'alias'|'first'} */ (current)]) {
      keyOwners.set(participantId, kind);
    }
  };

  for (const participant of participants) {
    const full = normalizeText(participant.displayName);
    if (full) add(full, participant.id, 'full');
    const first = full.split(' ')[0];
    if (first && first !== full) add(first, participant.id, 'first');
    for (const alias of participant.aliases ?? []) {
      const key = normalizeText(alias);
      if (key) add(key, participant.id, 'alias');
    }
  }

  const entries = [...owners.entries()]
    .map(([key, kinds]) => ({
      key,
      participantIds: [...kinds.keys()].sort(),
      kinds,
      ambiguous: kinds.size > 1,
    }))
    .sort((a, b) => b.key.length - a.key.length || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return { entries };
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
function isBoundary(text, index) {
  return index < 0 || index >= text.length || !isWordChar(text[index]);
}

/**
 * Longest index key starting exactly at `pos`, on word boundaries.
 * @param {string} text
 * @param {number} pos
 * @param {ParticipantIndex} index
 * @returns {NameMatch | null}
 */
function matchNameAt(text, pos, index) {
  if (!isBoundary(text, pos - 1)) return null;
  for (const entry of index.entries) {
    const end = pos + entry.key.length;
    if (text.startsWith(entry.key, pos) && isBoundary(text, end)) return { entry, start: pos, end };
  }
  return null;
}

/**
 * Matches a name at `pos`, skipping up to MAX_FILLERS filler words.
 * @param {string} text
 * @param {number} pos
 * @param {ParticipantIndex} index
 * @returns {NameMatch | null}
 */
function matchNameWithFillers(text, pos, index) {
  let cursor = pos;
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1;
  for (let skipped = 0; skipped <= MAX_FILLERS; skipped += 1) {
    const match = matchNameAt(text, cursor, index);
    if (match) return match;
    const word = /^(\p{L}+)[ \t]*,?[ \t]*/u.exec(text.slice(cursor, cursor + 40));
    if (!word || !FILLER_WORDS.has(word[1])) return null;
    cursor += word[0].length;
  }
  return null;
}

/**
 * Matches "X", "X y Y", "X, Y y Z" starting at `pos`.
 * @param {string} text
 * @param {number} pos
 * @param {ParticipantIndex} index
 * @returns {NameMatch[]}
 */
function matchNameChain(text, pos, index) {
  /** @type {NameMatch[]} */
  const matches = [];
  let cursor = pos;
  for (let n = 0; n < MAX_CHAINED_NAMES; n += 1) {
    const match = matchNameWithFillers(text, cursor, index);
    if (!match) break;
    matches.push(match);
    const separator = NAME_SEPARATOR.exec(text.slice(match.end, match.end + 12));
    if (!separator) break;
    cursor = match.end + separator[0].length;
  }
  return matches;
}

/**
 * @param {string} text
 * @param {number} end
 * @returns {number}
 */
function extendOverPunctuation(text, end) {
  return text[end] === ':' || text[end] === ',' ? end + 1 : end;
}

/**
 * @param {object} args
 * @param {NameMatch[]} args.chain
 * @param {number} args.spanStart
 * @param {string} args.normalized
 * @param {number[]} args.map
 * @param {string} args.original
 * @param {string} args.signal
 * @param {string} args.source
 * @returns {AssignmentSignal[]}
 */
function signalsFromChain({ chain, spanStart, normalized, map, original, signal, source }) {
  const spanEnd = extendOverPunctuation(normalized, chain[chain.length - 1].end);
  const matchedText = sliceOriginal(original, map, spanStart, spanEnd);
  /** @type {AssignmentSignal[]} */
  const signals = [];
  for (const match of chain) {
    for (const participantId of match.entry.participantIds) {
      signals.push({
        participantId,
        signal,
        confidence: SIGNAL_CONFIDENCE[signal],
        matchedText,
        ambiguous: match.entry.ambiguous,
        groupId: match.entry.ambiguous ? `${source}:${match.start}` : null,
      });
    }
  }
  return signals;
}

/**
 * @typedef {Object} ExtractionContext
 * @property {string}           normalized
 * @property {number[]}         map
 * @property {string}           original
 * @property {ParticipantIndex} index
 */

/**
 * Trigger-based explicit signals ("carta para X", "querido X", …) starting before `limit`.
 * @param {ExtractionContext & { triggers: readonly RegExp[], signal: string, limit: number, source: string }} ctx
 * @returns {{ signals: AssignmentSignal[], spans: Array<[number, number]> }}
 */
function extractTriggered(ctx) {
  const { normalized, triggers, limit, index } = ctx;
  /** @type {AssignmentSignal[]} */
  const signals = [];
  /** @type {Array<[number, number]>} */
  const spans = [];
  for (const pattern of triggers) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let found;
    while ((found = regex.exec(normalized)) !== null) {
      if (found.index >= limit) break;
      if (found[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }
      const chain = matchNameChain(normalized, found.index + found[0].length, index);
      if (chain.length === 0) continue;
      signals.push(...signalsFromChain({ ...ctx, chain, spanStart: found.index }));
      for (const match of chain) spans.push([match.start, match.end]);
    }
  }
  return { signals, spans };
}

/**
 * Salutation lines inside the scan window: "Juan:", "Buenos días Pedro,", "Juan y Ana:".
 * @param {ExtractionContext & { limit: number }} ctx
 * @returns {{ signals: AssignmentSignal[], spans: Array<[number, number]> }}
 */
function extractSalutationLines(ctx) {
  const { normalized, limit, index } = ctx;
  /** @type {AssignmentSignal[]} */
  const signals = [];
  /** @type {Array<[number, number]>} */
  const spans = [];
  let offset = 0;
  for (const line of normalized.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    if (lineStart >= limit) break;
    if (!line) continue;

    const prefix = GREETING_PREFIX.exec(line);
    const chain = matchNameChain(normalized, lineStart + (prefix ? prefix[0].length : 0), index);
    if (chain.length === 0) continue;
    const rest = normalized.slice(chain[chain.length - 1].end, lineStart + line.length);
    if (!SALUTATION_END.test(rest)) continue;

    signals.push(
      ...signalsFromChain({ ...ctx, chain, spanStart: lineStart, signal: SignalType.BODY_EXPLICIT, source: 'body' }),
    );
    for (const match of chain) spans.push([match.start, match.end]);
  }
  return { signals, spans };
}

/**
 * NAME_MENTION: full display name or alias anywhere in the cleaned body (bare first names
 * are not mentions). Occurrences overlapping explicit matches are skipped.
 * @param {ExtractionContext & { excluded: Array<[number, number]> }} ctx
 * @returns {AssignmentSignal[]}
 */
function extractMentions({ normalized, map, original, index, excluded }) {
  /** @type {AssignmentSignal[]} */
  const signals = [];
  const taken = [...excluded];
  for (const entry of index.entries) {
    const owners = entry.participantIds.filter((id) => entry.kinds.get(id) !== 'first');
    if (owners.length === 0) continue;
    let from = 0;
    for (;;) {
      const at = normalized.indexOf(entry.key, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + entry.key.length;
      if (!isBoundary(normalized, at - 1) || !isBoundary(normalized, end)) continue;
      if (taken.some(([s, e]) => at < e && end > s)) continue;
      taken.push([at, end]);
      const matchedText = sliceOriginal(original, map, at, end);
      for (const participantId of owners) {
        signals.push({
          participantId,
          signal: SignalType.NAME_MENTION,
          confidence: SIGNAL_CONFIDENCE[SignalType.NAME_MENTION],
          matchedText,
          ambiguous: entry.ambiguous,
          groupId: entry.ambiguous ? `mention:${at}` : null,
        });
      }
    }
  }
  return signals;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * @param {string | null | undefined} signal
 * @returns {boolean}
 */
function isExplicit(signal) {
  return EXPLICIT_SIGNALS.includes(/** @type {string} */ (signal));
}

/**
 * An ambiguous occurrence ("Querida María:") is resolved when exactly one of its candidates
 * also has an unambiguous explicit signal (e.g. "Carta para María García" in the subject);
 * the other candidates of that occurrence are dropped.
 * @param {readonly AssignmentSignal[]} signals
 * @returns {AssignmentSignal[]}
 */
function resolveAmbiguousGroups(signals) {
  const confirmed = new Set(signals.filter((s) => !s.ambiguous && isExplicit(s.signal)).map((s) => s.participantId));
  /** @type {Map<string, AssignmentSignal[]>} */
  const groups = new Map();
  for (const signal of signals) {
    if (!signal.ambiguous || !signal.groupId) continue;
    const members = groups.get(signal.groupId) ?? [];
    members.push(signal);
    groups.set(signal.groupId, members);
  }
  const drop = new Set();
  for (const members of groups.values()) {
    const confirmedIds = new Set(members.filter((s) => confirmed.has(s.participantId)).map((s) => s.participantId));
    if (confirmedIds.size !== 1) continue;
    for (const member of members) if (!confirmedIds.has(member.participantId)) drop.add(member);
  }
  return signals.filter((signal) => !drop.has(signal));
}

/**
 * @typedef {Object} Candidate
 * @property {string}           participantId
 * @property {AssignmentSignal} best
 * @property {number}           score     Best confidence.
 * @property {boolean}          ambiguous Whether the best signal is ambiguous.
 * @property {number}           total     Sum of confidences (tie-break only).
 */

/**
 * @param {readonly AssignmentSignal[]} signals
 * @returns {Candidate[]}
 */
function rankCandidates(signals) {
  /** @type {Map<string, AssignmentSignal[]>} */
  const byParticipant = new Map();
  for (const signal of signals) {
    const list = byParticipant.get(signal.participantId) ?? [];
    list.push(signal);
    byParticipant.set(signal.participantId, list);
  }
  const candidates = [...byParticipant.entries()].map(([participantId, list]) => {
    const best = [...list].sort(
      (a, b) => b.confidence - a.confidence || Number(Boolean(a.ambiguous)) - Number(Boolean(b.ambiguous)),
    )[0];
    return {
      participantId,
      best,
      score: best.confidence,
      ambiguous: Boolean(best.ambiguous),
      total: list.reduce((sum, s) => sum + s.confidence, 0),
    };
  });
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.ambiguous) - Number(b.ambiguous) ||
      b.total - a.total ||
      (a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0),
  );
  return candidates;
}

/**
 * @param {readonly Candidate[]} candidates
 * @returns {import('../entities/Assignment.js').AssignmentMatch[]}
 */
function toMatches(candidates) {
  return candidates.map((c) => ({
    participantId: c.participantId,
    signal: c.best.signal,
    confidence: c.best.confidence,
    matchedText: c.best.matchedText,
  }));
}

/**
 * Turns extracted signals into an assignment.
 * - 2+ participants with unambiguous explicit signals (>= threshold) → multi-recipient.
 * - Exactly one top candidate >= threshold, unambiguous, and no other within `margin` → assigned.
 * - Otherwise NEEDS_REVIEW with ranked suggestions (never dropped).
 * @param {readonly AssignmentSignal[]} signals
 * @param {{ minConfidence?: number, margin?: number }} [options]
 * @returns {Readonly<import('../entities/Assignment.js').Assignment>}
 */
export function decideAssignment(signals, options = {}) {
  const minConfidence = options.minConfidence ?? DEFAULTS.ASSIGNMENT_MIN_CONFIDENCE;
  const margin = options.margin ?? DEFAULTS.ASSIGNMENT_MARGIN;
  const candidates = rankCandidates(resolveAmbiguousGroups(signals));
  const qualifies = (/** @type {Candidate} */ c) => c.score >= minConfidence - EPSILON;

  const explicit = candidates.filter((c) => isExplicit(c.best.signal) && !c.ambiguous && qualifies(c));
  const pendingAmbiguous = candidates.some((c) => isExplicit(c.best.signal) && c.ambiguous && qualifies(c));

  if (explicit.length >= 2 && !pendingAmbiguous) {
    const primary = explicit[0];
    return createAssignment({
      participantIds: explicit.map((c) => c.participantId),
      status: AssignmentStatus.ASSIGNED,
      signal: primary.best.signal,
      confidence: primary.score,
      matchedText: primary.best.matchedText,
      suggestedParticipantIds: [],
      matches: toMatches(explicit),
    });
  }

  const [top, second] = candidates;
  const clearWinner =
    top !== undefined &&
    explicit.length < 2 &&
    !top.ambiguous &&
    qualifies(top) &&
    (second === undefined || top.score - second.score >= margin - EPSILON);

  if (clearWinner) {
    return createAssignment({
      participantIds: [top.participantId],
      status: AssignmentStatus.ASSIGNED,
      signal: top.best.signal,
      confidence: top.score,
      matchedText: top.best.matchedText,
      suggestedParticipantIds: [],
      matches: toMatches([top]),
    });
  }

  return createAssignment({
    participantIds: [],
    status: AssignmentStatus.NEEDS_REVIEW,
    signal: top ? top.best.signal : null,
    confidence: top ? top.score : 0,
    matchedText: top ? top.best.matchedText : '',
    suggestedParticipantIds: candidates.map((c) => c.participantId),
    matches: toMatches(candidates),
  });
}

/**
 * Applies a manual override. Overrides ALWAYS win; an empty list means "leave unassigned".
 * @param {Readonly<import('../entities/Assignment.js').Assignment> | null | undefined} computed
 * @param {Pick<import('../entities/AssignmentOverride.js').AssignmentOverride, 'participantIds'> | null | undefined} override
 * @returns {Readonly<import('../entities/Assignment.js').Assignment>}
 */
export function applyAssignmentOverride(computed, override) {
  if (!override) {
    return computed ?? createAssignment({ status: AssignmentStatus.NEEDS_REVIEW });
  }
  const participantIds = [...new Set(override.participantIds)];
  return createAssignment({
    participantIds,
    status: participantIds.length > 0 ? AssignmentStatus.ASSIGNED : AssignmentStatus.UNASSIGNED,
    signal: SignalType.MANUAL,
    confidence: SIGNAL_CONFIDENCE[SignalType.MANUAL],
    matchedText: '',
    suggestedParticipantIds: computed?.suggestedParticipantIds ?? [],
    matches: participantIds.map((participantId) => ({
      participantId,
      signal: SignalType.MANUAL,
      confidence: SIGNAL_CONFIDENCE[SignalType.MANUAL],
      matchedText: '',
    })),
  });
}

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function assertRatio(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new AppError('VALIDATION_ERROR', 500, undefined, { reason: `${field} must be a number within 0..1` });
  }
  return value;
}

/**
 * @typedef {Object} AssignmentInput
 * @property {string} [subject]
 * @property {string} [body]  Full plain-text body (cleaned internally for analysis only).
 * @property {string} [from]  Used only to strip the sender's own name from the signature.
 */

export class ContentAssignmentStrategy {
  /** @type {Readonly<{ minConfidence: number, margin: number, bodyScanChars: number }>} */
  #options;

  /** @type {WeakMap<readonly object[], ParticipantIndex>} */
  #indexCache = new WeakMap();

  /**
   * @param {{ minConfidence?: number, margin?: number, bodyScanChars?: number }} [options]
   */
  constructor({
    minConfidence = DEFAULTS.ASSIGNMENT_MIN_CONFIDENCE,
    margin = DEFAULTS.ASSIGNMENT_MARGIN,
    bodyScanChars = DEFAULTS.BODY_SCAN_CHARS,
  } = {}) {
    assertRatio(minConfidence, 'minConfidence');
    assertRatio(margin, 'margin');
    if (!Number.isInteger(bodyScanChars) || bodyScanChars < 0) {
      throw new AppError('VALIDATION_ERROR', 500, undefined, { reason: 'bodyScanChars must be a non-negative integer' });
    }
    this.#options = Object.freeze({ minConfidence, margin, bodyScanChars });
  }

  get options() {
    return this.#options;
  }

  /**
   * The index is cached per participants array (treat the array as immutable).
   * @param {readonly import('../entities/Participant.js').Participant[]} participants
   * @returns {ParticipantIndex}
   */
  #indexFor(participants) {
    if (!Array.isArray(participants)) {
      throw new AppError('VALIDATION_ERROR', 500, undefined, { reason: 'participants must be an array' });
    }
    let index = this.#indexCache.get(participants);
    if (!index) {
      index = buildParticipantIndex(participants);
      this.#indexCache.set(participants, index);
    }
    return index;
  }

  /**
   * @param {AssignmentInput} input
   * @param {readonly import('../entities/Participant.js').Participant[]} participants
   * @returns {AssignmentSignal[]}
   */
  extractSignals(input, participants) {
    const index = this.#indexFor(participants);
    if (index.entries.length === 0) return [];
    const { subject = '', body = '', from = '' } = input ?? {};

    const subjectText = stripSubjectPrefixes(subject);
    const subjectNorm = normalizeWithMap(subjectText, { keepNewlines: false });
    const subjectSignals = extractTriggered({
      normalized: subjectNorm.text,
      map: subjectNorm.map,
      original: subjectText,
      index,
      triggers: SUBJECT_TRIGGERS,
      signal: SignalType.SUBJECT_EXPLICIT,
      limit: Number.POSITIVE_INFINITY,
      source: 'subject',
    }).signals;

    const bodyText = cleanForAnalysis({ body, from });
    const bodyNorm = normalizeWithMap(bodyText, { keepNewlines: true });
    const context = { normalized: bodyNorm.text, map: bodyNorm.map, original: bodyText, index };
    const limit = this.#options.bodyScanChars;

    const triggered = extractTriggered({
      ...context,
      triggers: BODY_TRIGGERS,
      signal: SignalType.BODY_EXPLICIT,
      limit,
      source: 'body',
    });
    const salutations = extractSalutationLines({ ...context, limit });
    const mentions = extractMentions({ ...context, excluded: [...triggered.spans, ...salutations.spans] });

    return [...subjectSignals, ...triggered.signals, ...salutations.signals, ...mentions];
  }

  /**
   * @param {AssignmentInput} input
   * @param {readonly import('../entities/Participant.js').Participant[]} participants
   * @param {{ override?: Pick<import('../entities/AssignmentOverride.js').AssignmentOverride, 'participantIds'> | null }} [options]
   * @returns {Readonly<import('../entities/Assignment.js').Assignment>}
   */
  assign(input, participants, { override = null } = {}) {
    const computed = decideAssignment(this.extractSignals(input, participants), this.#options);
    return applyAssignmentOverride(computed, override);
  }
}
