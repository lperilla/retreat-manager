import { definePort } from './definePort.js';

/**
 * Renders a batch export payload into one file format (HTML packet, TXT, JSON).
 * Rendering is an adapter concern; the application never builds HTML or text itself.
 *
 * @typedef {import('../../domain/entities/BatchExportPayload.js').BatchExportPayload} BatchExportPayload
 *
 * @typedef {Object} RenderOptions
 * @property {boolean} [includeAttachments]  Embed printable attachments when the format supports it.
 *
 * @typedef {Object} ExportRendererPort
 * @property {string} format     'html' | 'txt' | 'json'
 * @property {string} extension  File extension without the dot.
 * @property {string} mimeType
 * @property {(payload: BatchExportPayload, options?: RenderOptions) => Promise<string | Uint8Array>} render
 */

export const ExportRendererPort = definePort('ExportRendererPort', ['render'], ['format', 'extension', 'mimeType']);
