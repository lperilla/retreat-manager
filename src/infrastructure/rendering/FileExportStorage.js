import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { AppError } from '../../domain/errors.js';

const SAFE_FILENAME = /^[a-z0-9][a-z0-9._-]{0,180}$/i;

/**
 * ExportStoragePort adapter writing files under EXPORT_DIR.
 * Filenames are generated server-side; anything that is not a plain safe filename, or that
 * would resolve outside the export directory, is rejected.
 * @implements {import('../../application/ports/ExportStoragePort.js').ExportStoragePort}
 */
export class FileExportStorage {
  #directory;

  /**
   * @param {{ exportDir: string }} options
   */
  constructor({ exportDir }) {
    this.#directory = resolve(exportDir);
  }

  get directory() {
    return this.#directory;
  }

  /**
   * Resolves a filename inside the export directory or throws.
   * @param {string} filename
   * @returns {string}
   */
  resolvePath(filename) {
    if (typeof filename !== 'string' || !SAFE_FILENAME.test(filename) || filename.includes('..')) {
      throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'unsafe export filename' });
    }
    const target = resolve(join(this.#directory, filename));
    const rel = relative(this.#directory, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'export path escapes EXPORT_DIR' });
    }
    return target;
  }

  /**
   * @param {string} filename
   * @param {string | Uint8Array} content
   * @returns {Promise<{ filePath: string }>}
   */
  async save(filename, content) {
    const filePath = this.resolvePath(filename);
    await mkdir(this.#directory, { recursive: true });
    await writeFile(filePath, content, typeof content === 'string' ? 'utf8' : undefined);
    return { filePath };
  }
}
