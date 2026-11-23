import { createAuditEntry } from '../../domain/entities/AuditEntry.js';
import { describeError } from './errorDescription.js';

/**
 * Normalizes the name of the person making a change (header / body value from the web).
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeActor(value, fallback = 'staff') {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || fallback;
}

/**
 * Records who changed which letters and, when Gmail labels are enabled, pushes the
 * resulting label differences to Gmail. Neither step ever fails the user's change: the
 * database is already updated, and errors are logged and kept per message for a retry.
 */
export class MailChangeRecorder {
  #audit;
  #labelSync;
  #clock;
  #idGenerator;
  #logger;

  /**
   * @param {{
   *   auditLog: import('../ports/AuditLogRepositoryPort.js').AuditLogRepositoryPort,
   *   labelSync?: { enabled: boolean, execute: (input: { actor: string, messageIds: string[] }) => Promise<unknown> } | null,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   idGenerator: () => string,
   *   logger: import('../ports/LoggerPort.js').LoggerPort,
   * }} deps
   */
  constructor({ auditLog, labelSync = null, clock, idGenerator, logger }) {
    this.#audit = auditLog;
    this.#labelSync = labelSync;
    this.#clock = clock;
    this.#idGenerator = idGenerator;
    this.#logger = logger;
  }

  /**
   * @param {{ actor?: unknown, action: string, messageIds: readonly string[], participantIds?: readonly string[], details?: Record<string, unknown> }} change
   */
  async record({ actor, action, messageIds, participantIds = [], details = {} }) {
    const who = normalizeActor(actor);
    const ids = [...new Set(messageIds)];
    if (ids.length === 0) return;
    try {
      const at = this.#clock.now();
      await this.#audit.appendMany(
        ids.map((messageId) => createAuditEntry({ id: this.#idGenerator(), at, actor: who, action, messageId, participantIds, details })),
      );
    } catch (error) {
      this.#logger.error({ err: describeError(error), action }, 'Could not write the audit log');
    }
    if (this.#labelSync?.enabled) {
      try {
        await this.#labelSync.execute({ actor: who, messageIds: ids });
      } catch (error) {
        this.#logger.warn({ err: describeError(error), action }, 'Gmail labels not updated; they will be retried on the next label sync');
      }
    }
  }
}
