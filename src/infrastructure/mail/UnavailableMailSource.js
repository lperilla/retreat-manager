import { AppError } from '../../domain/errors.js';

/**
 * Mail source used when Gmail is not configured but the local store can still be read
 * (e.g. the MCP server on a machine without token.json). Every sync attempt is refused
 * with MAIL_SOURCE_NOT_CONFIGURED.
 * @implements {import('../../application/ports/MailSourcePort.js').MailSourcePort}
 */
export class UnavailableMailSource {
  #reason;

  /**
   * @param {string} [reason]
   */
  constructor(reason = 'Gmail is not configured') {
    this.#reason = reason;
  }

  async fetchChanges() {
    throw new AppError('MAIL_SOURCE_NOT_CONFIGURED', 503, undefined, { reason: this.#reason });
  }

  async fetchAttachment() {
    throw new AppError('ATTACHMENTS_UNAVAILABLE', 503, undefined, { reason: this.#reason });
  }
}
