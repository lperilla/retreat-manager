import { describeError } from '../../application/services/errorDescription.js';
import { mapGmailError } from './gmailErrors.js';
import { httpStatusOf, mapWithConcurrency, withRetry } from './retry.js';

/**
 * "A/B/C" → ["A", "A/B"].
 * @param {string} name
 */
function ancestorsOf(name) {
  const parts = name.split('/');
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** Gmail palette green (white text), used for the printed label so it stands out. */
export const PRINTED_LABEL_COLOR = Object.freeze({ backgroundColor: '#16a766', textColor: '#ffffff' });

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
  #printedKey;
  #printedColored = false;
  #parentName;
  #parentEnsured = false;

  /**
   * @param {{
   *   gmail: import('googleapis').gmail_v1.Gmail,
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   *   concurrency?: number,
   *   parentLabel?: string | null,  Parent label of the participant labels (the prefix): created so they nest under it.
   *   printedLabel?: string | null,  Name of the printed label: created (or updated) in green.
   *   retry?: import('./retry.js').RetryOptions,
   * }} options
   */
  constructor({ gmail, logger, concurrency = 5, printedLabel = null, parentLabel = null, retry = {} }) {
    this.#parentName = parentLabel || null;
    this.#printedKey = printedLabel ? GmailLabelService.#key(printedLabel) : null;
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
   * An existing printed label (created by hand or by an older version) is turned green once per run.
   * Failing to color it never blocks labelling.
   * @param {string} name
   * @param {string} id
   */
  async #colorPrinted(name, id) {
    if (this.#printedColored || GmailLabelService.#key(name) !== this.#printedKey) return;
    this.#printedColored = true;
    try {
      await this.#call(() => this.#gmail.users.labels.patch({ userId: 'me', id, requestBody: { color: PRINTED_LABEL_COLOR } }));
    } catch (error) {
      this.#logger.warn({ err: describeError(error), label: name }, 'Could not color the printed label');
    }
  }

  /**
   * @param {string} name
   * @returns {Promise<string>} Label id (existing or just created).
   */
  async #ensure(name) {
    // A nested name ("Parent/Child") only shows under its parent in Gmail if the parent exists: create it first.
    const slash = name.lastIndexOf('/');
    if (slash > 0) await this.#ensure(name.slice(0, slash));
    const cache = this.#cache ?? (await this.#loadLabels());
    const known = cache.get(GmailLabelService.#key(name));
    if (known) {
      await this.#colorPrinted(name, known);
      return known;
    }
    try {
      const created = await this.#call(() =>
        this.#gmail.users.labels.create({
          userId: 'me',
          requestBody: {
            name,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
            ...(GmailLabelService.#key(name) === this.#printedKey ? { color: PRINTED_LABEL_COLOR } : {}),
          },
        }),
      );
      const id = /** @type {string} */ (created.data.id);
      cache.set(GmailLabelService.#key(name), id);
      if (GmailLabelService.#key(name) === this.#printedKey) this.#printedColored = true;
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
   * Deletes user labels by name (a name that does not exist is skipped).
   * @param {string[]} names
   * @returns {Promise<string[]>} Names deleted.
   */
  async deleteLabels(names) {
    const cache = await this.#loadLabels();
    const deleted = [];
    for (const name of names) {
      const id = cache.get(GmailLabelService.#key(name));
      if (!id) continue;
      try {
        await this.#call(() => this.#gmail.users.labels.delete({ userId: 'me', id }));
      } catch (error) {
        if (httpStatusOf(error) !== 404) throw error;
      }
      cache.delete(GmailLabelService.#key(name));
      deleted.push(name);
      this.#logger.info({ label: name }, 'Gmail label deleted (no longer used)');
    }
    // A parent label left without children is deleted too, but only when it carries no messages
    // (it may be a label of the user's own).
    const parents = [...new Set(deleted.flatMap((name) => ancestorsOf(name)))].sort((a, b) => b.length - a.length);
    for (const parent of parents) {
      const key = GmailLabelService.#key(parent);
      const id = cache.get(key);
      if (!id || [...cache.keys()].some((other) => other.startsWith(`${key}/`))) continue;
      const info = await this.#call(() => this.#gmail.users.labels.get({ userId: 'me', id }));
      if (Number(info.data.messagesTotal ?? 1) !== 0) continue;
      try {
        await this.#call(() => this.#gmail.users.labels.delete({ userId: 'me', id }));
      } catch (error) {
        if (httpStatusOf(error) !== 404) throw error;
      }
      cache.delete(key);
      deleted.push(parent);
      this.#logger.info({ label: parent }, 'Empty parent Gmail label deleted');
    }
    return deleted;
  }

  /**
   * @param {import('../../application/ports/MailLabelPort.js').LabelChange[]} changes
   * @returns {Promise<import('../../application/ports/MailLabelPort.js').LabelChangeResult[]>}
   */
  async applyChanges(changes) {
    if (changes.length === 0) return [];
    // Resolve every label once, sequentially (creation must not race with itself).
    if (this.#parentName && !this.#parentEnsured) {
      await this.#ensure(this.#parentName);
      this.#parentEnsured = true;
    }
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
