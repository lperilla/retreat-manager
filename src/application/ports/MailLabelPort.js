import { definePort } from './definePort.js';

/**
 * Label operations on the mailbox. Label names are used (never ids): the adapter creates
 * missing labels once and reuses existing ones.
 *
 * @typedef {Object} LabelChange
 * @property {string}   messageId
 * @property {string[]} add     Label names to add (created when missing).
 * @property {string[]} remove  Label names to remove (ignored when the label does not exist).
 *
 * @typedef {Object} LabelChangeResult
 * @property {string}  messageId
 * @property {boolean} ok
 * @property {string} [error]  Per-message failure (e.g. the message no longer exists).
 *
 * @typedef {Object} MailLabelPort
 * @property {(changes: LabelChange[]) => Promise<LabelChangeResult[]>} applyChanges
 * @property {(names: string[]) => Promise<string[]>} [deleteLabels]
 *   Optional: deletes labels that no message of the app uses any more (renamed prefix / printed label).
 *   Returns the names actually deleted.
 * @property {() => Promise<string[]>} [listLabelNames]
 *   Optional: names of every user label in the mailbox (used by the label reset).
 *   Throws AppError (GMAIL_AUTH_ERROR, GMAIL_INSUFFICIENT_PERMISSIONS, GMAIL_UNAVAILABLE) when the whole call cannot proceed.
 */
export const MailLabelPort = definePort('MailLabelPort', ['applyChanges']);
