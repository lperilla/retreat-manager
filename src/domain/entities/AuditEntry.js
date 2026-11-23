import { AppError } from '../errors.js';

/**
 * Append-only trace of a change made to a letter (who, when, what).
 *
 * @typedef {Object} AuditEntry
 * @property {string}   id
 * @property {Date}     at
 * @property {string}   actor       Staff member ("sync" for automatic runs).
 * @property {string}   action      e.g. "assignment.set", "print.marked", "labels.applied".
 * @property {string}   messageId   Gmail message id.
 * @property {string[]} participantIds
 * @property {Record<string, unknown>} details
 */

/**
 * @param {{ id: string, at: Date | string | number, actor?: string, action: string, messageId: string, participantIds?: readonly string[], details?: Record<string, unknown> }} props
 * @returns {Readonly<AuditEntry>}
 */
export function createAuditEntry(props) {
  const { id, at, actor = 'staff', action, messageId, participantIds = [], details = {} } = props ?? {};
  if (typeof id !== 'string' || !id || typeof action !== 'string' || !action || typeof messageId !== 'string' || !messageId) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'audit entry needs id, action and messageId' });
  }
  const date = at instanceof Date ? new Date(at.getTime()) : new Date(at);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'audit entry date is not valid' });
  }
  return Object.freeze({
    id,
    at: date,
    actor: String(actor || 'staff').slice(0, 80),
    action,
    messageId,
    participantIds: Object.freeze([...participantIds]),
    details: Object.freeze({ ...details }),
  });
}
