import { definePort } from './definePort.js';

/**
 * Downloads attachment bytes on demand from the mail source (Gmail, demo). Implemented by
 * the mail source adapters; only the attachment processor uses it.
 *
 * @typedef {Object} AttachmentSourcePort
 * @property {(request: { messageId: string, attachment: import('../../domain/entities/Letter.js').AttachmentMeta }) => Promise<Uint8Array>} fetchAttachment
 *   Throws ATTACHMENT_NOT_FOUND when the attachment no longer exists.
 */

export const AttachmentSourcePort = definePort('AttachmentSourcePort', ['fetchAttachment']);
