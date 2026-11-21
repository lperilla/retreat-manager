import { readFile } from 'node:fs/promises';

import { CursorExpiredError } from '../../../application/ports/MailSourcePort.js';
import { AppError } from '../../../domain/errors.js';
import { DEMO_ATTACHMENT_ASSETS, DEMO_WAVES } from './demo/demoData.js';

const CURSOR_PATTERN = /^demo:(\d+)$/;
const ASSETS_DIR = new URL('./demo/assets/', import.meta.url);

/**
 * MailSourcePort adapter for demo mode. Releases the demo letters in deterministic waves:
 * - `fetchChanges(null)` (initial load or "Sincronización completa") returns the complete
 *   listing of every wave released so far (at least wave 1), with `isFullListing: true`.
 * - `fetchChanges('demo:N')` releases wave N+1 (new letters and deletions).
 * - After the last wave, incremental syncs return no changes.
 * - Any other cursor is reported as expired (exercises the full-sync fallback).
 * @implements {import('../../../application/ports/MailSourcePort.js').MailSourcePort}
 */
export class DemoMailSource {
  /** @type {ReadonlyArray<import('./demo/demoData.js').DemoWave>} */
  #waves;
  #released = 0;

  /**
   * @param {{ waves?: ReadonlyArray<import('./demo/demoData.js').DemoWave> }} [options]
   */
  constructor({ waves = DEMO_WAVES } = {}) {
    this.#waves = waves;
  }

  /** Number of waves released in this process. */
  get releasedWaves() {
    return this.#released;
  }

  get totalWaves() {
    return this.#waves.length;
  }

  /**
   * @param {string | null} cursor
   * @returns {Promise<import('../../../application/ports/MailSourcePort.js').MailChanges>}
   */
  async fetchChanges(cursor) {
    if (cursor === null) return this.#fullListing();

    const match = CURSOR_PATTERN.exec(cursor);
    const position = match ? Number(match[1]) : Number.NaN;
    if (!Number.isInteger(position) || position < 1 || position > this.#waves.length) {
      throw new CursorExpiredError('Demo cursor is not valid', { cursor });
    }
    if (position >= this.#waves.length) {
      return { letters: [], deletedMessageIds: [], nextCursor: cursor, isFullListing: false };
    }
    const next = position + 1;
    this.#released = Math.max(this.#released, next);
    const wave = this.#waves[next - 1];
    return {
      letters: [...wave.letters],
      deletedMessageIds: [...wave.deletedMessageIds],
      nextCursor: `demo:${next}`,
      isFullListing: false,
    };
  }

  /**
   * AttachmentSourcePort: serves the bundled demo files.
   * @param {{ messageId: string, attachment: import('../../../domain/entities/Letter.js').AttachmentMeta }} request
   * @returns {Promise<Uint8Array>}
   */
  async fetchAttachment({ attachment }) {
    const asset = attachment.attachmentId ? /** @type {Record<string, string>} */ (DEMO_ATTACHMENT_ASSETS)[attachment.attachmentId] : undefined;
    if (!asset) throw new AppError('ATTACHMENT_NOT_FOUND', 404, undefined, { attachmentId: attachment.attachmentId });
    return readFile(new URL(asset, ASSETS_DIR));
  }

  /**
   * @returns {import('../../../application/ports/MailSourcePort.js').MailChanges}
   */
  #fullListing() {
    const upTo = Math.max(1, this.#released);
    this.#released = upTo;
    const released = this.#waves.slice(0, upTo);
    const deleted = new Set(released.flatMap((wave) => wave.deletedMessageIds));
    const letters = released.flatMap((wave) => wave.letters).filter((letter) => !deleted.has(letter.messageId));
    return { letters, deletedMessageIds: [...deleted], nextCursor: `demo:${upTo}`, isFullListing: true };
  }
}
