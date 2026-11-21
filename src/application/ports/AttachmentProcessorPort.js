import { definePort } from './definePort.js';

/**
 * File processing for attachments. The domain only knows attachment metadata; downloading,
 * content verification, caching, thumbnails and text extraction live in this adapter.
 *
 * @typedef {import('../../domain/entities/Letter.js').AttachmentMeta} AttachmentMeta
 *
 * @typedef {'image' | 'pdf' | 'docx' | 'unsupported' | 'blocked'} AttachmentKind
 *
 * @typedef {'original' | 'display' | 'thumbnail'} AttachmentVariant
 *   original  = the file as received (served with a safe content type);
 *   display   = images only: auto-rotated (EXIF), HEIC→JPEG, metadata stripped, ≤ 1600 px;
 *   thumbnail = images only: ≤ 320 px JPEG.
 *
 * @typedef {Object} AttachmentContent
 * @property {Uint8Array} data
 * @property {string}     mimeType   Content type to serve (application/octet-stream when the file is not trusted).
 * @property {string}     filename
 * @property {boolean}    verified   True when the bytes match the declared type.
 *
 * @typedef {Object} AttachmentProcessorPort
 * @property {(attachment: AttachmentMeta) => AttachmentKind} classify
 * @property {(request: { messageId: string, attachment: AttachmentMeta, variant: AttachmentVariant }) => Promise<AttachmentContent>} getContent
 * @property {(request: { messageId: string, attachment: AttachmentMeta }) => Promise<string>} extractText  DOCX → plain text.
 */

export const AttachmentProcessorPort = definePort('AttachmentProcessorPort', ['classify', 'getContent', 'extractText']);
