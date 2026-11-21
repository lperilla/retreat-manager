import { AssignmentStatus, SignalType } from '../constants.js';
import { AppError } from '../errors.js';

/**
 * Evidence persisted for one participant of an assignment.
 * @typedef {Object} AssignmentMatch
 * @property {string}      participantId
 * @property {string}      signal        One of SignalType.
 * @property {number}      confidence    0..1
 * @property {string}      matchedText   Original text fragment that produced the signal.
 */

/**
 * @typedef {Object} Assignment
 * @property {string[]}          participantIds          Participants the letter counts for (empty unless ASSIGNED).
 * @property {string}            status                  One of AssignmentStatus.
 * @property {string|null}       signal                  Signal of the primary match (null when nothing matched).
 * @property {number}            confidence              Confidence of the primary match, 0..1.
 * @property {string}            matchedText             Text of the primary match ('' when none).
 * @property {string[]}          suggestedParticipantIds Ranked candidates (only meaningful for NEEDS_REVIEW).
 * @property {AssignmentMatch[]} matches                 Evidence per participant (assigned or suggested).
 */

const STATUSES = new Set(Object.values(AssignmentStatus));
const SIGNALS = new Set(Object.values(SignalType));

/**
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(reason) {
  return new AppError('INVALID_ASSIGNMENT', 400, undefined, { reason });
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string[]}
 */
function uniqueIds(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
  const out = [];
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0) throw invalid(`${field} must contain non-empty strings`);
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {number}
 */
function ratio(value, field) {
  const number = value === undefined || value === null ? 0 : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw invalid(`${field} must be within 0..1`);
  return number;
}

/**
 * @param {Partial<AssignmentMatch>} match
 * @returns {Readonly<AssignmentMatch>}
 */
function createMatch(match) {
  if (!match || typeof match.participantId !== 'string' || !match.participantId) {
    throw invalid('match.participantId is required');
  }
  if (!SIGNALS.has(/** @type {string} */ (match.signal))) throw invalid(`unknown signal "${match.signal}"`);
  return Object.freeze({
    participantId: match.participantId,
    signal: /** @type {string} */ (match.signal),
    confidence: ratio(match.confidence, 'match.confidence'),
    matchedText: typeof match.matchedText === 'string' ? match.matchedText : '',
  });
}

/**
 * Creates a validated, immutable assignment.
 * @param {Partial<Assignment>} props
 * @returns {Readonly<Assignment>}
 */
export function createAssignment(props) {
  const source = props ?? {};
  const status = source.status ?? AssignmentStatus.NEEDS_REVIEW;
  if (!STATUSES.has(status)) throw invalid(`unknown status "${status}"`);

  const participantIds = uniqueIds(source.participantIds, 'participantIds');
  if (status === AssignmentStatus.ASSIGNED && participantIds.length === 0) {
    throw invalid('an ASSIGNED letter needs at least one participant');
  }
  if (status !== AssignmentStatus.ASSIGNED && participantIds.length > 0) {
    throw invalid(`a ${status} letter cannot have participants`);
  }

  const signal = source.signal ?? null;
  if (signal !== null && !SIGNALS.has(signal)) throw invalid(`unknown signal "${signal}"`);

  const matches = Array.isArray(source.matches) ? source.matches.map(createMatch) : [];

  return Object.freeze({
    participantIds: Object.freeze(participantIds),
    status,
    signal,
    confidence: ratio(source.confidence, 'confidence'),
    matchedText: typeof source.matchedText === 'string' ? source.matchedText : '',
    suggestedParticipantIds: Object.freeze(uniqueIds(source.suggestedParticipantIds, 'suggestedParticipantIds')),
    matches: Object.freeze(matches),
  });
}

/**
 * Default assignment for a letter nobody has analysed yet.
 * @param {string[]} [suggestedParticipantIds]
 * @returns {Readonly<Assignment>}
 */
export function needsReviewAssignment(suggestedParticipantIds = []) {
  return createAssignment({ status: AssignmentStatus.NEEDS_REVIEW, suggestedParticipantIds });
}

/**
 * @param {Pick<Assignment, 'status'> | null | undefined} assignment
 * @returns {boolean}
 */
export function isAssigned(assignment) {
  return assignment?.status === AssignmentStatus.ASSIGNED;
}

/**
 * @param {Pick<Assignment, 'signal'> | null | undefined} assignment
 * @returns {boolean}
 */
export function isManualAssignment(assignment) {
  return assignment?.signal === SignalType.MANUAL;
}
