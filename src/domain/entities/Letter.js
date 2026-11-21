import { FlagType, WARNING_FLAG_TYPES } from '../constants.js';
import { AppError } from '../errors.js';
import { createAssignment, isAssigned, needsReviewAssignment } from './Assignment.js';

/**
 * Attachment metadata. The domain never handles file contents.
 * @typedef {Object} AttachmentMeta
 * @property {string}      filename
 * @property {string}      mimeType
 * @property {number}      size          Bytes.
 * @property {string|null} contentId     For inline (`cid:`) images.
 * @property {string|null} attachmentId  Opaque reference used by the mail adapter to fetch contents on demand.
 */

/**
 * Heuristic flag. Flags never discard a letter.
 * @typedef {Object} LetterFlag
 * @property {string} type        One of FlagType.
 * @property {number} confidence  0..1
 * @property {string} reason      Spanish explanation shown to staff.
 */

/**
 * A letter is one Gmail message (reply threads are never merged).
 * @typedef {Object} Letter
 * @property {string}           messageId    Gmail message id; primary key.
 * @property {string}           threadId
 * @property {string}           from
 * @property {string}           to
 * @property {string}           subject
 * @property {Date}             receivedAt
 * @property {string}           cleanBody    Full plain-text body (never truncated).
 * @property {AttachmentMeta[]} attachments
 * @property {import('./Assignment.js').Assignment} assignment
 * @property {LetterFlag[]}     flags
 * @property {string}           contentHash  Fingerprint of the mail content (used by syncDiff).
 * @property {Date|null}        firstSeenAt
 * @property {string|null}      syncRunId    Sync run that first stored the letter.
 * @property {boolean}          seenByStaff
 * @property {Date|null}        deletedAt    Soft-delete marker (deleted from Gmail).
 */

const FLAG_TYPES = new Set(Object.values(FlagType));
const WARNING_TYPES = new Set(WARNING_FLAG_TYPES);

/**
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(reason) {
  return new AppError('INVALID_LETTER', 400, undefined, { reason });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function text(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Date}
 */
function requiredDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(/** @type {any} */ (value));
  if (value === undefined || value === null || value === '' || Number.isNaN(date.getTime())) {
    throw invalid(`${field} must be a valid date`);
  }
  return date;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Date|null}
 */
function optionalDate(value, field) {
  if (value === undefined || value === null) return null;
  return requiredDate(value, field);
}

/**
 * 53-bit string hash (cyrb53). Deterministic, dependency-free; not cryptographic.
 * @param {string} input
 * @returns {string}
 */
function hash53(input) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/**
 * @param {Partial<AttachmentMeta>} meta
 * @returns {Readonly<AttachmentMeta>}
 */
export function createAttachmentMeta(meta) {
  const source = meta ?? {};
  const size = Number(source.size ?? 0);
  if (!Number.isFinite(size) || size < 0) throw invalid('attachment.size must be a non-negative number');
  return Object.freeze({
    filename: text(source.filename).trim() || 'adjunto',
    mimeType: text(source.mimeType).trim().toLowerCase() || 'application/octet-stream',
    size,
    contentId: source.contentId ? String(source.contentId) : null,
    attachmentId: source.attachmentId ? String(source.attachmentId) : null,
  });
}

/**
 * @param {Partial<LetterFlag>} flag
 * @returns {Readonly<LetterFlag>}
 */
export function createFlag(flag) {
  const source = flag ?? {};
  if (!FLAG_TYPES.has(/** @type {string} */ (source.type))) {
    throw new AppError('INVALID_FLAG', 400, undefined, { reason: `unknown flag type "${source.type}"` });
  }
  const confidence = Number(source.confidence ?? 1);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AppError('INVALID_FLAG', 400, undefined, { reason: 'flag.confidence must be within 0..1' });
  }
  return Object.freeze({
    type: /** @type {string} */ (source.type),
    confidence,
    reason: text(source.reason),
  });
}

/**
 * Fingerprint of the content coming from the mail source. It deliberately ignores
 * assignment, flags and novelty fields so that recomputation never looks like an update.
 * @param {Pick<Letter, 'subject' | 'from' | 'to' | 'receivedAt' | 'cleanBody' | 'attachments'>} letter
 * @returns {string}
 */
export function computeContentHash(letter) {
  const payload = JSON.stringify([
    text(letter.subject),
    text(letter.from),
    text(letter.to),
    letter.receivedAt instanceof Date ? letter.receivedAt.toISOString() : text(letter.receivedAt),
    text(letter.cleanBody),
    (letter.attachments ?? []).map((a) => [a.filename, a.mimeType, a.size, a.contentId ?? null]),
  ]);
  return hash53(payload);
}

/**
 * Creates a validated, immutable letter.
 * @param {Partial<Omit<Letter, 'receivedAt' | 'firstSeenAt' | 'deletedAt'>> & {
 *   messageId: string,
 *   receivedAt: Date | string | number,
 *   firstSeenAt?: Date | string | number | null,
 *   deletedAt?: Date | string | number | null,
 * }} props
 * @returns {Readonly<Letter>}
 */
export function createLetter(props) {
  const source = props ?? /** @type {any} */ ({});
  if (typeof source.messageId !== 'string' || source.messageId.trim() === '') {
    throw invalid('messageId is required');
  }
  if (source.attachments !== undefined && source.attachments !== null && !Array.isArray(source.attachments)) {
    throw invalid('attachments must be an array');
  }
  if (source.flags !== undefined && source.flags !== null && !Array.isArray(source.flags)) {
    throw invalid('flags must be an array');
  }

  const content = {
    messageId: source.messageId.trim(),
    threadId: text(source.threadId),
    from: text(source.from),
    to: text(source.to),
    subject: text(source.subject),
    receivedAt: requiredDate(source.receivedAt, 'receivedAt'),
    cleanBody: text(source.cleanBody).replace(/\r\n?/g, '\n'),
    attachments: Object.freeze((source.attachments ?? []).map(createAttachmentMeta)),
  };

  return Object.freeze({
    ...content,
    assignment: source.assignment ? createAssignment(source.assignment) : needsReviewAssignment(),
    flags: Object.freeze((source.flags ?? []).map(createFlag)),
    contentHash: computeContentHash(content),
    firstSeenAt: optionalDate(source.firstSeenAt, 'firstSeenAt'),
    syncRunId: source.syncRunId ? String(source.syncRunId) : null,
    seenByStaff: source.seenByStaff === true,
    deletedAt: optionalDate(source.deletedAt, 'deletedAt'),
  });
}

/**
 * @param {Pick<Letter, 'deletedAt'>} letter
 * @returns {boolean}
 */
export function isLetterActive(letter) {
  return !letter.deletedAt;
}

/**
 * "New" letters are those staff have not seen yet (soft-deleted letters excluded).
 * @param {Pick<Letter, 'seenByStaff' | 'deletedAt'>} letter
 * @returns {boolean}
 */
export function isNewLetter(letter) {
  return isLetterActive(letter) && letter.seenByStaff === false;
}

/**
 * Participants a letter counts for. NEEDS_REVIEW / UNASSIGNED letters count for nobody.
 * @param {Pick<Letter, 'assignment'>} letter
 * @returns {readonly string[]}
 */
export function assignedParticipantIds(letter) {
  return isAssigned(letter.assignment) ? letter.assignment.participantIds : [];
}

/**
 * @param {Pick<Letter, 'assignment'>} letter
 * @param {string} participantId
 * @returns {boolean}
 */
export function isAssignedTo(letter, participantId) {
  return assignedParticipantIds(letter).includes(participantId);
}

/**
 * @param {Pick<Letter, 'flags'>} letter
 * @returns {boolean}
 */
export function hasWarningFlags(letter) {
  return letter.flags.some((flag) => WARNING_TYPES.has(flag.type));
}

/**
 * @param {Pick<Letter, 'flags'>} letter
 * @param {string} type
 * @returns {boolean}
 */
export function hasFlag(letter, type) {
  return letter.flags.some((flag) => flag.type === type);
}

/**
 * @param {Letter} letter
 * @param {import('./Assignment.js').Assignment} assignment
 * @param {LetterFlag[]} [flags]
 * @returns {Readonly<Letter>}
 */
export function withAssignment(letter, assignment, flags) {
  return createLetter({ ...letter, assignment, flags: flags ?? letter.flags });
}

/**
 * @param {Letter} letter
 * @returns {Readonly<Letter>}
 */
export function markLetterSeen(letter) {
  return letter.seenByStaff ? letter : createLetter({ ...letter, seenByStaff: true });
}

/**
 * @param {Letter} letter
 * @param {Date} now
 * @returns {Readonly<Letter>}
 */
export function softDeleteLetter(letter, now) {
  return letter.deletedAt ? letter : createLetter({ ...letter, deletedAt: now });
}

/**
 * Merges a letter coming from the mail source with the stored version.
 * Preserves novelty data (`firstSeenAt`, `syncRunId`, `seenByStaff`) of known letters
 * and restores soft-deleted letters that reappear.
 * @param {Letter | null | undefined} existing
 * @param {Letter} incoming  Letter with assignment and flags already computed.
 * @param {{ now: Date, syncRunId: string }} context
 * @returns {Readonly<Letter>}
 */
export function mergeIncomingLetter(existing, incoming, { now, syncRunId }) {
  if (!existing) {
    return createLetter({ ...incoming, firstSeenAt: now, syncRunId, seenByStaff: false, deletedAt: null });
  }
  return createLetter({
    ...incoming,
    firstSeenAt: existing.firstSeenAt ?? now,
    syncRunId: existing.syncRunId ?? syncRunId,
    seenByStaff: existing.seenByStaff,
    deletedAt: null,
  });
}
