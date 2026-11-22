import { PrintStatusValue } from '../constants.js';
import { AppError } from '../errors.js';

/**
 * Print status per participant, stored locally and never touched by a sync.
 *
 * `printedLetterIds` records WHICH letters have been printed for the participant, so letters
 * that arrive afterwards show up as new ("sin imprimir") and can be printed on their own.
 * Statuses saved by older versions only have `status` + `printedAt`: for them, the letters
 * stored before `printedAt` count as printed (see isLetterPrinted).
 *
 * @typedef {Object} PrintStatus
 * @property {string}    participantId
 * @property {string}    status            'pending' | 'printed' (stored; see participantPrintState for the live value)
 * @property {Date|null} printedAt         Last time something was marked as printed.
 * @property {string[]}  printedLetterIds  messageIds printed for this participant.
 */

const VALUES = new Set(Object.values(PrintStatusValue));
const MAX_PRINTED_LETTERS = 5000;

/**
 * @param {unknown} list
 * @returns {string[]}
 */
function letterIds(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new AppError('INVALID_PRINT_STATUS', 400, undefined, { reason: 'printedLetterIds must be an array' });
  const ids = [...new Set(list.filter((id) => typeof id === 'string' && id.length > 0 && id.length <= 200))];
  if (ids.length > MAX_PRINTED_LETTERS) throw new AppError('INVALID_PRINT_STATUS', 400, undefined, { reason: 'too many printed letters' });
  return ids;
}

/**
 * @param {{ participantId: string, status?: string, printedAt?: Date | string | number | null, printedLetterIds?: readonly string[] | null }} props
 * @returns {Readonly<PrintStatus>}
 */
export function createPrintStatus(props) {
  const { participantId, status = PrintStatusValue.PENDING, printedAt = null, printedLetterIds = [] } = props ?? {};
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
  const ids = status === PrintStatusValue.PRINTED ? letterIds(printedLetterIds) : [];
  return Object.freeze({ participantId, status, printedAt: date, printedLetterIds: Object.freeze(ids) });
}

/**
 * Stored status saved by an older version: printed, but without the list of letters.
 * @param {Pick<PrintStatus, 'status' | 'printedLetterIds'> | null | undefined} printStatus
 */
function isLegacyPrinted(printStatus) {
  return printStatus?.status === PrintStatusValue.PRINTED && printStatus.printedLetterIds.length === 0;
}

/**
 * Whether `letter` has been printed for the participant of `printStatus`.
 * @param {PrintStatus | null | undefined} printStatus
 * @param {Pick<import('./Letter.js').Letter, 'messageId' | 'receivedAt' | 'firstSeenAt'>} letter
 * @returns {boolean}
 */
export function isLetterPrinted(printStatus, letter) {
  if (!printStatus || printStatus.status !== PrintStatusValue.PRINTED) return false;
  if (printStatus.printedLetterIds.includes(letter.messageId)) return true;
  if (!isLegacyPrinted(printStatus) || !printStatus.printedAt) return false;
  const storedAt = letter.firstSeenAt ?? letter.receivedAt;
  return storedAt instanceof Date && storedAt.getTime() <= printStatus.printedAt.getTime();
}

/**
 * Live print state of a participant from their current letters: pending while any letter is
 * not printed. Without letters, the stored status is kept.
 * @param {PrintStatus | null | undefined} printStatus
 * @param {ReadonlyArray<Pick<import('./Letter.js').Letter, 'messageId' | 'receivedAt' | 'firstSeenAt'>>} letters  Active letters of the participant.
 * @returns {{ status: string, printedCount: number, unprintedCount: number, printedAt: Date | null }}
 */
export function participantPrintState(printStatus, letters) {
  const printedCount = letters.filter((letter) => isLetterPrinted(printStatus, letter)).length;
  const unprintedCount = letters.length - printedCount;
  const status =
    letters.length === 0
      ? printStatus?.status === PrintStatusValue.PRINTED
        ? PrintStatusValue.PRINTED
        : PrintStatusValue.PENDING
      : unprintedCount === 0
        ? PrintStatusValue.PRINTED
        : PrintStatusValue.PENDING;
  return { status, printedCount, unprintedCount, printedAt: printStatus?.printedAt ?? null };
}

/**
 * Marks letters as printed (added to those already printed).
 * @param {PrintStatus | null | undefined} current
 * @param {string} participantId
 * @param {readonly string[]} messageIds
 * @param {Date} now
 * @param {ReadonlyArray<Pick<import('./Letter.js').Letter, 'messageId' | 'receivedAt' | 'firstSeenAt'>>} [letters]  Current letters, to keep what an older status counted as printed.
 * @returns {Readonly<PrintStatus>}
 */
export function markLettersPrinted(current, participantId, messageIds, now, letters = []) {
  const already = letters.filter((letter) => isLetterPrinted(current, letter)).map((letter) => letter.messageId);
  const ids = [...new Set([...(current?.printedLetterIds ?? []), ...already, ...messageIds])];
  if (ids.length === 0) return markPending(participantId);
  return createPrintStatus({ participantId, status: PrintStatusValue.PRINTED, printedAt: now, printedLetterIds: ids });
}

/**
 * Marks letters as NOT printed (the rest keep their state).
 * @param {PrintStatus | null | undefined} current
 * @param {string} participantId
 * @param {readonly string[]} messageIds
 * @param {ReadonlyArray<Pick<import('./Letter.js').Letter, 'messageId' | 'receivedAt' | 'firstSeenAt'>>} [letters]
 * @returns {Readonly<PrintStatus>}
 */
export function markLettersUnprinted(current, participantId, messageIds, letters = []) {
  const removed = new Set(messageIds);
  const already = letters.filter((letter) => isLetterPrinted(current, letter)).map((letter) => letter.messageId);
  const ids = [...new Set([...(current?.printedLetterIds ?? []), ...already])].filter((id) => !removed.has(id));
  if (ids.length === 0) return markPending(participantId);
  return createPrintStatus({ participantId, status: PrintStatusValue.PRINTED, printedAt: current?.printedAt ?? null, printedLetterIds: ids });
}

/**
 * Every letter given is printed (the participant's current letters).
 * @param {string} participantId
 * @param {Date} now
 * @param {readonly string[]} [messageIds]
 * @returns {Readonly<PrintStatus>}
 */
export function markPrinted(participantId, now, messageIds = []) {
  return createPrintStatus({ participantId, status: PrintStatusValue.PRINTED, printedAt: now, printedLetterIds: [...messageIds] });
}

/**
 * Nothing printed.
 * @param {string} participantId
 * @returns {Readonly<PrintStatus>}
 */
export function markPending(participantId) {
  return createPrintStatus({ participantId, status: PrintStatusValue.PENDING });
}

/**
 * A participant without a stored status is pending (stored value; prefer participantPrintState
 * when the letters are at hand).
 * @param {Pick<PrintStatus, 'status'> | null | undefined} printStatus
 * @returns {boolean}
 */
export function isPendingPrint(printStatus) {
  return !printStatus || printStatus.status !== PrintStatusValue.PRINTED;
}
