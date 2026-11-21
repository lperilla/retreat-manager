import { definePort } from './definePort.js';

/**
 * Stores rendered exports under EXPORT_DIR. The adapter must reject any filename that
 * would resolve outside the export directory.
 *
 * @typedef {Object} ExportStoragePort
 * @property {(filename: string, content: string | Uint8Array) => Promise<{ filePath: string }>} save
 */

export const ExportStoragePort = definePort('ExportStoragePort', ['save']);
