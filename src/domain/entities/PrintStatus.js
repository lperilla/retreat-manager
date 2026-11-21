import { PrintStatusValue } from '../constants.js';
import { AppError } from '../errors.js';

/**
 * Print status per participant, stored locally and never touched by a sync.
 * @typedef {Object} PrintStatus
 * @property {string}    participantId
 * @property {string}    status     'pending' | 'printed'
 * @property {Date|null} printedAt
 */

const VALUES = new Set(Object.values(PrintStatusValue));

/**
 * @param {{ participantId: string, status?: string, printedAt?: Date | string | number | null }} props
 * @returns {Readonly<PrintStatus>}
 */
export function createPrintStatus(props) {
  const { participantId, status = PrintStatusValue.PENDING, printedAt = null } = props ?? {};
  if (typeof participantId !== 'string' || participantId.length === 0) {
    throw new AppError('INVALID_PRINT_STATUS', 400, undefined, { reason: 'participantId is required' });
  }
  if (!VALUES.has(status)) {
    throw new AppError('INVALID_PRINT_STATUS', 400, undefined, { reason: `unknown status "${status}"` });
  }
  let date = null;
  if (status === PrintStatusValue.PRINTED && printedAt !== null && printedAt !== undefined) {
    date = printedAt instanceof Date ? new Date(printedAt.getTime()) : new Date(printedAt);
    if (Number.isNaN(date.getTime())) {
      throw new AppError('INVALID_PRINT_STATUS', 400, undefined, { reason: 'printedAt is not a valid date' });
    }
  }
  return Object.freeze({ participantId, status, printedAt: date });
}

/**
 * @param {string} participantId
 * @param {Date} now
 * @returns {Readonly<PrintStatus>}
 */
export function markPrinted(participantId, now) {
  return createPrintStatus({ participantId, status: PrintStatusValue.PRINTED, printedAt: now });
}

/**
 * @param {string} participantId
 * @returns {Readonly<PrintStatus>}
 */
export function markPending(participantId) {
  return createPrintStatus({ participantId, status: PrintStatusValue.PENDING });
}

/**
 * A participant without a stored status is pending.
 * @param {Pick<PrintStatus, 'status'> | null | undefined} printStatus
 * @returns {boolean}
 */
export function isPendingPrint(printStatus) {
  return !printStatus || printStatus.status !== PrintStatusValue.PRINTED;
}
