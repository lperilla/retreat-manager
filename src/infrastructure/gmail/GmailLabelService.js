import { describeError } from '../../application/services/errorDescription.js';
import { mapGmailError } from './gmailErrors.js';
import { httpStatusOf, mapWithConcurrency, withRetry } from './retry.js';

/**
 * Gmail adapter of MailLabelPort (users.labels + users.messages.modify).
 *
 * - Labels are looked up by name (Gmail names are case-insensitive) in a cache filled with
 *   one `labels.list`, and created only when missing, so they are never duplicated. A
 *   409 "already exists" (another process created it first) refreshes the cache and reuses it.
 * - Applying a label that a message already has is a no-op in Gmail, so retries are safe.
 * - A message that no longer exists (404) fails only that message; authentication,
 *   permission and connection errors abort the whole call with a mapped AppError.
 *
 * Needs the gmail.modify scope (read + label changes; it cannot send or delete mail).
 * @implements {import('../../application/ports/MailLabelPort.js').MailLabelPort}
 */
export class GmailLabelService {
  #gmail;
  #logger;
  #retry;
  #concurrency;
  /** @type {Map<string, string> | null} */
  #cache = null;

  /**
   * @param {{
   *   gmail: import('googleapis').gmail_v1.Gmail,
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   *   concurrency?: number,
   *   retry?: import('./retry.js').RetryOptions,
   * }} options
   */
  constructor({ gmail, logger, concurrency = 5, retry = {} }) {
    this.#gmail = gmail;
    this.#logger = logger;
    this.#concurrency = concurrency;
    this.#retry = { ...retry, onRetry: (/** @type {any} */ info) => this.#logger.warn(info, 'Gmail label call failed; retrying') };
  }

  /**
   * @template T
   * @param {() => Promise<T>} call
   * @returns {Promise<T>}
   */
  async #call(call) {
    try {
      return await withRetry(call, this.#retry);
    } catch (error) {
      throw mapGmailError(error) ?? error;
    }
  }

  /** @param {string} name */
  static #key(name) {
    return name.trim().toLowerCase();
  }

  async #loadLabels() {
    const response = await this.#call(() => this.#gmail.users.labels.list({ userId: 'me' }));
    this.#cache = new Map();
    for (const label of response.data.labels ?? []) {
      if (label.id && label.name) this.#cache.set(GmailLabelService.#key(label.name), label.id);
    }
    return this.#cache;
  }

  /**
   * @param {string} name
   * @returns {Promise<string>} Label id (existing or just created).
   */
  async #ensure(name) {
    const cache = this.#cache ?? (await this.#loadLabels());
    const known = cache.get(GmailLabelService.#key(name));
    if (known) return known;
    try {
      const created = await this.#call(() =>
        this.#gmail.users.labels.create({
          userId: 'me',
          requestBody: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
        }),
      );
      const id = /** @type {string} */ (created.data.id);
      cache.set(GmailLabelService.#key(name), id);
      this.#logger.info({ label: name }, 'Gmail label created');
      return id;
    } catch (error) {
      if (httpStatusOf(error) !== 409) throw error;
      const refreshed = await this.#loadLabels();
      const id = refreshed.get(GmailLabelService.#key(name));
      if (!id) throw error;
      return id;
    }
  }

  /**
   * @param {import('../../application/ports/MailLabelPort.js').LabelChange[]} changes
   * @returns {Promise<import('../../application/ports/MailLabelPort.js').LabelChangeResult[]>}
   */
  async applyChanges(changes) {
    if (changes.length === 0) return [];
    // Resolve every label once, sequentially (creation must not race with itself).
    const names = [...new Set(changes.flatMap((change) => change.add))];
    /** @type {Map<string, string>} */
    const ids = new Map();
    for (const name of names) ids.set(name, await this.#ensure(name));
    const cache = this.#cache ?? (await this.#loadLabels());

    return mapWithConcurrency(changes, this.#concurrency, async (change) => {
      const addLabelIds = [...new Set(change.add.map((name) => /** @type {string} */ (ids.get(name))))];
      const removeLabelIds = [
        ...new Set(change.remove.map((name) => cache.get(GmailLabelService.#key(name))).filter((id) => typeof id === 'string')),
      ].filter((id) => !addLabelIds.includes(id));
      if (addLabelIds.length === 0 && removeLabelIds.length === 0) return { messageId: change.messageId, ok: true };
      try {
        await this.#call(() =>
          this.#gmail.users.messages.modify({ userId: 'me', id: change.messageId, requestBody: { addLabelIds, removeLabelIds } }),
        );
        return { messageId: change.messageId, ok: true };
      } catch (error) {
        if (httpStatusOf(error) === 404) {
          return { messageId: change.messageId, ok: false, error: 'El mensaje ya no existe en Gmail' };
        }
        if (error && typeof error === 'object' && 'code' in error && /^GMAIL_/.test(String(/** @type {any} */ (error).code))) throw error;
        return { messageId: change.messageId, ok: false, error: describeError(error) };
      }
    });
  }
}
