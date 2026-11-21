import { definePort } from './definePort.js';

/**
 * A message as delivered by the mail source, before assignment and flags.
 * @typedef {Object} IncomingMessage
 * @property {string} messageId
 * @property {string} threadId
 * @property {string} from
 * @property {string} to
 * @property {string} subject
 * @property {Date | string} receivedAt
 * @property {string} body          Plain text (HTML already converted and sanitized by the adapter).
 * @property {Array<{ filename: string, mimeType: string, size: number, contentId?: string | null, attachmentId?: string | null }>} attachments
 * @property {Record<string, string>} headers  Raw headers used only by heuristics (never persisted).
 */

/**
 * @typedef {Object} MailChanges
 * @property {IncomingMessage[]} letters            New or changed messages.
 * @property {string[]}          deletedMessageIds  Messages removed from the mailbox since the cursor.
 * @property {string}            nextCursor         Cursor to store once the batch is persisted.
 * @property {boolean}           [isFullListing]    True when `letters` is the complete set (full sync);
 *                                                  known letters missing from it are soft-deleted.
 */

/**
 * @typedef {Object} MailSourcePort
 * @property {(cursor: string | null) => Promise<MailChanges>} fetchChanges
 *   `null` requests a full listing. Throws `CursorExpiredError` when the cursor is no longer valid.
 */

export const MailSourcePort = definePort('MailSourcePort', ['fetchChanges']);

/**
 * Raised by a mail source when the stored cursor can no longer be used
 * (e.g. Gmail history id too old → HTTP 404). The sync falls back to a full listing.
 */
export class CursorExpiredError extends Error {
  /**
   * @param {string} [message]
   * @param {{ cursor?: string | null, cause?: unknown }} [options]
   */
  constructor(message = 'Mail source cursor is no longer valid', { cursor = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'CursorExpiredError';
    this.code = 'CURSOR_EXPIRED';
    this.cursor = cursor;
  }
}
