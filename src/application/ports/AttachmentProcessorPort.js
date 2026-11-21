import { definePort } from './definePort.js';

/**
 * File processing for attachments (implemented in the attachments phase). The domain only
 * knows attachment metadata; downloading, caching, thumbnails and text extraction live here.
 *
 * @typedef {import('../../domain/entities/Letter.js').AttachmentMeta} AttachmentMeta
 *
 * @typedef {'image' | 'pdf' | 'docx' | 'unsupported'} AttachmentKind
 *
 * @typedef {Object} AttachmentContent
 * @property {Uint8Array} data
 * @property {string}     mimeType
 * @property {string}     filename
 *
 * @typedef {Object} AttachmentProcessorPort
 * @property {(attachment: AttachmentMeta) => AttachmentKind} classify
 * @property {(request: { messageId: string, attachment: AttachmentMeta, variant: 'original' | 'thumbnail' | 'display' }) => Promise<AttachmentContent>} getContent
 * @property {(request: { messageId: string, attachment: AttachmentMeta }) => Promise<string>} extractText
 */

export const AttachmentProcessorPort = definePort('AttachmentProcessorPort', ['classify', 'getContent', 'extractText']);
