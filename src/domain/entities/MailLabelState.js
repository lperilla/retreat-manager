import { AppError } from '../errors.js';

/**
 * What the app last applied to a Gmail message: the participant labels and the printed label.
 * It is the memory that makes label synchronization idempotent (only differences are sent).
 *
 * @typedef {Object} MailLabelState
 * @property {string}      messageId   Gmail message id (primary key).
 * @property {string[]}    labels      Participant label names currently applied by the app.
 * @property {boolean}     printed     Whether the printed label is applied.
 * @property {string|null} printedLabel Name the printed label had when it was applied (it may be renamed later).
 * @property {Date|null}   syncedAt    Last successful synchronization with Gmail.
 * @property {string}      updatedBy   Who caused the last change ("sync" for automatic runs).
 * @property {string|null} error       Last error for this message (null when the last attempt succeeded).
 */

/**
 * @param {{ messageId: string, labels?: readonly string[], printed?: boolean, printedLabel?: string | null, syncedAt?: Date | string | number | null, updatedBy?: string, error?: string | null }} props
 * @returns {Readonly<MailLabelState>}
 */
export function createMailLabelState(props) {
  const { messageId, labels = [], printed = false, printedLabel = null, syncedAt = null, updatedBy = 'sync', error = null } = props ?? {};
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'label state messageId is required' });
  }
  if (!Array.isArray(labels) || labels.some((label) => typeof label !== 'string' || label.length === 0)) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'label state labels must be strings' });
  }
  let date = null;
  if (syncedAt !== null && syncedAt !== undefined) {
    date = syncedAt instanceof Date ? new Date(syncedAt.getTime()) : new Date(syncedAt);
    if (Number.isNaN(date.getTime())) {
      throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'label state syncedAt is not a valid date' });
    }
  }
  return Object.freeze({
    messageId,
    labels: Object.freeze([...new Set(labels)].sort()),
    printed: printed === true,
    printedLabel: printed === true && printedLabel ? String(printedLabel) : null,
    syncedAt: date,
    updatedBy: String(updatedBy || 'sync').slice(0, 80),
    error: error ? String(error).slice(0, 500) : null,
  });
}
