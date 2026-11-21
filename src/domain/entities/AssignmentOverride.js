import { AppError } from '../errors.js';

/**
 * Manual assignment decided by staff. Always wins over heuristics and survives
 * re-syncs and recomputation. An empty `participantIds` means "leave unassigned".
 * @typedef {Object} AssignmentOverride
 * @property {string}   messageId
 * @property {string[]} participantIds
 * @property {Date}     updatedAt
 */

/**
 * @param {{ messageId: string, participantIds?: string[], updatedAt?: Date | string | number }} props
 * @returns {Readonly<AssignmentOverride>}
 */
export function createAssignmentOverride(props) {
  const { messageId, participantIds = [], updatedAt = new Date(0) } = props ?? {};
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new AppError('INVALID_ASSIGNMENT', 400, undefined, { reason: 'override.messageId is required' });
  }
  if (!Array.isArray(participantIds) || participantIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new AppError('INVALID_ASSIGNMENT', 400, undefined, { reason: 'override.participantIds must be strings' });
  }
  const date = updatedAt instanceof Date ? new Date(updatedAt.getTime()) : new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('INVALID_ASSIGNMENT', 400, undefined, { reason: 'override.updatedAt is not a valid date' });
  }
  return Object.freeze({
    messageId,
    participantIds: Object.freeze([...new Set(participantIds)]),
    updatedAt: date,
  });
}
