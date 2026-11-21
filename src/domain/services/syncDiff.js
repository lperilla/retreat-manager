/**
 * Pure sync diff: classifies an incoming batch against what is already stored.
 *
 * - added:     messageId not known.
 * - updated:   known and content changed, or known but soft-deleted and now back (restored).
 * - unchanged: known, active and same content fingerprint.
 * - deleted:   reported deleted by the source, known and still active (→ soft delete).
 *
 * A message reported both as incoming and deleted in the same batch is treated as deleted.
 * Incoming duplicates are collapsed by messageId (the last occurrence wins), so running the
 * same batch twice yields 0 added the second time.
 */
import { assignedParticipantIds, computeContentHash } from '../entities/Letter.js';
import { compareLettersChronologically } from './grouping.js';

/**
 * @typedef {Object} KnownLetterRef
 * @property {string}           messageId
 * @property {string}           contentHash
 * @property {Date|null}        [deletedAt]
 */

/**
 * @typedef {Object} SyncDiffResult
 * @property {import('../entities/Letter.js').Letter[]} added
 * @property {import('../entities/Letter.js').Letter[]} updated
 * @property {string[]} unchanged   messageIds
 * @property {string[]} deleted     messageIds to soft-delete
 * @property {string[]} restored    messageIds of soft-deleted letters that reappeared (subset of updated)
 * @property {import('../entities/SyncResult.js').ParticipantDelta[]} perParticipantDeltas
 */

/**
 * @param {Iterable<KnownLetterRef> | Map<string, Omit<KnownLetterRef, 'messageId'>> | null | undefined} known
 * @returns {Map<string, { contentHash: string, deletedAt: Date | null }>}
 */
function toKnownMap(known) {
  /** @type {Map<string, { contentHash: string, deletedAt: Date | null }>} */
  const map = new Map();
  if (!known) return map;
  if (known instanceof Map) {
    for (const [messageId, ref] of known) {
      map.set(messageId, { contentHash: ref.contentHash, deletedAt: ref.deletedAt ?? null });
    }
    return map;
  }
  for (const ref of known) map.set(ref.messageId, { contentHash: ref.contentHash, deletedAt: ref.deletedAt ?? null });
  return map;
}

/**
 * New letters per participant (only `added`; multi-recipient letters count for each).
 * Sorted by newLetters desc, then participantId.
 * @param {readonly import('../entities/Letter.js').Letter[]} added
 * @returns {import('../entities/SyncResult.js').ParticipantDelta[]}
 */
export function computeParticipantDeltas(added) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const letter of added) {
    for (const participantId of new Set(assignedParticipantIds(letter))) {
      counts.set(participantId, (counts.get(participantId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([participantId, newLetters]) => ({ participantId, newLetters }))
    .sort((a, b) => b.newLetters - a.newLetters || (a.participantId < b.participantId ? -1 : 1));
}

/**
 * @param {{
 *   known: Iterable<KnownLetterRef> | Map<string, Omit<KnownLetterRef, 'messageId'>> | null | undefined,
 *   incoming: readonly import('../entities/Letter.js').Letter[],
 *   deletedMessageIds?: readonly string[],
 * }} input
 * @returns {SyncDiffResult}
 */
export function syncDiff({ known, incoming, deletedMessageIds = [] }) {
  const knownMap = toKnownMap(known);
  const deletedSet = new Set(deletedMessageIds);

  /** @type {Map<string, import('../entities/Letter.js').Letter>} */
  const batch = new Map();
  for (const letter of incoming ?? []) batch.set(letter.messageId, letter);

  /** @type {import('../entities/Letter.js').Letter[]} */
  const added = [];
  /** @type {import('../entities/Letter.js').Letter[]} */
  const updated = [];
  /** @type {string[]} */
  const unchanged = [];
  /** @type {string[]} */
  const restored = [];

  for (const [messageId, letter] of batch) {
    if (deletedSet.has(messageId)) continue;
    const ref = knownMap.get(messageId);
    if (!ref) {
      added.push(letter);
      continue;
    }
    const hash = letter.contentHash || computeContentHash(letter);
    if (ref.deletedAt) {
      updated.push(letter);
      restored.push(messageId);
    } else if (ref.contentHash !== hash) {
      updated.push(letter);
    } else {
      unchanged.push(messageId);
    }
  }

  const deleted = [...deletedSet].filter((messageId) => {
    const ref = knownMap.get(messageId);
    return ref !== undefined && !ref.deletedAt;
  });

  added.sort(compareLettersChronologically);
  updated.sort(compareLettersChronologically);
  unchanged.sort();
  deleted.sort();
  restored.sort();

  return { added, updated, unchanged, deleted, restored, perParticipantDeltas: computeParticipantDeltas(added) };
}
