import { CursorExpiredError } from '../../application/ports/MailSourcePort.js';
import { describeError } from '../../application/services/errorDescription.js';
import { AppError } from '../../domain/errors.js';
import { extractMessageContent, headerMap } from './bodyExtractor.js';
import { mapGmailError } from './gmailErrors.js';
import { httpStatusOf, mapWithConcurrency, withRetry } from './retry.js';

const PAGE_SIZE = 500;
const EXCLUDED_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH']);

/**
 * @typedef {Object} GmailClient  Subset of `google.gmail({ version: 'v1' })` used here.
 * @property {{
 *   getProfile: (params: object) => Promise<{ data: { historyId?: string, emailAddress?: string } }>,
 *   messages: {
 *     list: (params: object) => Promise<{ data: { messages?: Array<{ id: string }>, nextPageToken?: string } }>,
 *     get: (params: object) => Promise<{ data: any }>,
 *     attachments: { get: (params: object) => Promise<{ data: { data?: string, size?: number } }> },
 *   },
 *   history: {
 *     list: (params: object) => Promise<{ data: { history?: any[], nextPageToken?: string, historyId?: string } }>,
 *   },
 * }} users
 */

/**
 * MailSourcePort adapter for Gmail (read-only scope).
 *
 * - Full sync: captures the mailbox `historyId` with `users.getProfile` BEFORE listing, then
 *   lists every message matching GMAIL_QUERY (or GMAIL_LABEL_ID) received from GMAIL_START_DATE on. The captured id becomes the
 *   next cursor, so mail arriving during the download is picked up by the next incremental.
 * - Incremental: `users.history.list` from the stored cursor with full pagination. History
 *   reports every mailbox change, so new messages are post-filtered (label, query, start date, drafts,
 *   spam, trash, sent-only). HTTP 404 → CursorExpiredError (the sync falls back to full).
 * - Every call is retried with exponential backoff on 429/5xx; message downloads run with a
 *   concurrency cap.
 * @implements {import('../../application/ports/MailSourcePort.js').MailSourcePort}
 */
export class GmailMailSource {
  /**
   * Label adapter sharing this connection; set by createGmailMailSource only when label
   * synchronization is enabled.
   * @type {import('../../application/ports/MailLabelPort.js').MailLabelPort | null}
   */
  labelPort = null;

  /** @type {GmailClient} */
  #gmail;
  #query;
  #labelId;
  #startAt;
  #concurrency;
  #minGapMs;
  #nextSlot = 0;
  #retry;
  #logger;

  /**
   * @param {{
   *   gmail: GmailClient,
   *   query?: string,
   *   labelId?: string | null,
   *   startAt?: Date | null,
   *   concurrency?: number,
   *   requestsPerSecond?: number,  Pacing of message downloads (0 = unlimited), to stay under Gmail's per-minute quota.
   *   retry?: import('./retry.js').RetryOptions,
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   * }} options
   */
  constructor({ gmail, query = '', labelId = null, startAt = null, concurrency = 5, requestsPerSecond = 0, retry = {}, logger }) {
    this.#minGapMs = requestsPerSecond > 0 ? Math.ceil(1000 / requestsPerSecond) : 0;
    this.#gmail = gmail;
    this.#query = query.trim();
    this.#labelId = labelId || null;
    this.#startAt = startAt ?? null;
    this.#concurrency = concurrency;
    this.#logger = logger.child({ component: 'gmail' });
    this.#retry = {
      ...retry,
      onRetry: (/** @type {{ attempt: number, delayMs: number, status: number | null }} */ info) =>
        this.#logger.warn(info, 'Gmail API call failed; retrying'),
    };
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
      // Authentication, permission and connection failures get a clear message; anything
      // else (e.g. 404 for an expired history id) is handled by the caller as before.
      throw mapGmailError(error) ?? error;
    }
  }

  /**
   * @param {string | null} cursor
   * @returns {Promise<import('../../application/ports/MailSourcePort.js').MailChanges>}
   */
  async fetchChanges(cursor) {
    return cursor === null ? this.#fullSync() : this.#incrementalSync(cursor);
  }

  async #fullSync() {
    const profile = await this.#call(() => this.#gmail.users.getProfile({ userId: 'me' }));
    const historyId = profile.data.historyId;
    if (!historyId) throw new Error('Gmail profile did not return a historyId');

    const ids = await this.#listMessageIds(this.#listingQuery());
    const messages = await this.#fetchMessages(ids);
    const letters = messages.filter((m) => m !== null && this.#isCandidate(m.raw)).map((m) => /** @type {any} */ (m).letter);
    this.#logger.info({ listed: ids.length, letters: letters.length }, 'Gmail full listing downloaded');
    return { letters, deletedMessageIds: [], nextCursor: String(historyId), isFullListing: true };
  }

  /**
   * @param {string} cursor
   */
  async #incrementalSync(cursor) {
    const added = new Set();
    const deleted = new Set();
    let pageToken;
    let latestHistoryId = cursor;
    const historyTypes = this.#labelId
      ? ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']
      : ['messageAdded', 'messageDeleted'];

    do {
      let response;
      try {
        response = await this.#call(() =>
          this.#gmail.users.history.list({
            userId: 'me',
            startHistoryId: cursor,
            historyTypes,
            maxResults: PAGE_SIZE,
            ...(this.#labelId ? { labelId: this.#labelId } : {}),
            ...(pageToken ? { pageToken } : {}),
          }),
        );
      } catch (error) {
        if (httpStatusOf(error) === 404) {
          throw new CursorExpiredError('Gmail history id is no longer valid', { cursor, cause: error });
        }
        throw error;
      }
      for (const entry of response.data.history ?? []) {
        for (const item of entry.messagesAdded ?? []) markAdded(item.message);
        for (const item of entry.messagesDeleted ?? []) markDeleted(item.message);
        if (this.#labelId) {
          for (const item of entry.labelsAdded ?? []) if (item.labelIds?.includes(this.#labelId)) markAdded(item.message);
          for (const item of entry.labelsRemoved ?? []) if (item.labelIds?.includes(this.#labelId)) markDeleted(item.message);
        }
      }
      if (response.data.historyId) latestHistoryId = String(response.data.historyId);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    /** @param {{ id?: string } | undefined} message */
    function markAdded(message) {
      if (!message?.id) return;
      added.add(message.id);
      deleted.delete(message.id);
    }
    /** @param {{ id?: string } | undefined} message */
    function markDeleted(message) {
      if (!message?.id) return;
      deleted.add(message.id);
      added.delete(message.id);
    }

    const addedIds = [...added];
    const fetched = await this.#fetchMessages(addedIds);
    fetched.forEach((message, index) => {
      if (message === null) deleted.add(addedIds[index]);
    });
    let candidates = /** @type {Array<{ raw: any, letter: any }>} */ (fetched.filter((m) => m !== null && this.#isCandidate(m.raw)));
    candidates = await this.#applyQueryFilter(candidates);

    this.#logger.info(
      { added: added.size, kept: candidates.length, deleted: deleted.size },
      'Gmail history changes downloaded',
    );
    return {
      letters: candidates.map((m) => m.letter),
      deletedMessageIds: [...deleted],
      nextCursor: latestHistoryId,
      isFullListing: false,
    };
  }

  /**
   * Gmail search syntax cannot be evaluated locally, so new messages are kept only if the
   * same query (bounded by their dates) returns them.
   * @param {Array<{ raw: any, letter: any }>} candidates
   */
  async #applyQueryFilter(candidates) {
    if (!this.#query || this.#labelId || candidates.length === 0) return candidates;
    const oldest = Math.min(...candidates.map((m) => Number(m.raw.internalDate ?? Date.now())));
    const afterSeconds = Math.max(0, Math.floor(oldest / 1000) - 86_400);
    const matching = new Set(await this.#listMessageIds(`(${this.#query}) after:${afterSeconds}`));
    return candidates.filter((m) => matching.has(m.raw.id));
  }

  /**
   * @param {string} query
   * @returns {Promise<string[]>}
   */
  async #listMessageIds(query) {
    const ids = [];
    let pageToken;
    do {
      const response = await this.#call(() =>
        this.#gmail.users.messages.list({
          userId: 'me',
          maxResults: PAGE_SIZE,
          ...(query ? { q: query } : {}),
          ...(this.#labelId ? { labelIds: [this.#labelId] } : {}),
          ...(pageToken ? { pageToken } : {}),
        }),
      );
      for (const message of response.data.messages ?? []) if (message.id) ids.push(message.id);
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    return ids;
  }

  /**
   * Downloads full messages (concurrency-capped). A message deleted meanwhile (404) → null.
   * @param {string[]} ids
   * @returns {Promise<Array<{ raw: any, letter: import('../../application/ports/MailSourcePort.js').IncomingMessage } | null>>}
   */
  /** Spaces message downloads evenly so a full sync does not burst past Gmail's quota. */
  async #pace() {
    if (this.#minGapMs === 0) return;
    const now = Date.now();
    const slot = Math.max(now, this.#nextSlot);
    this.#nextSlot = slot + this.#minGapMs;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  }

  #fetchMessages(ids) {
    return mapWithConcurrency(ids, this.#concurrency, async (id) => {
      try {
        await this.#pace();
        const response = await this.#call(() => this.#gmail.users.messages.get({ userId: 'me', id, format: 'full' }));
        return { raw: response.data, letter: toIncomingMessage(response.data) };
      } catch (error) {
        if (httpStatusOf(error) === 404) return null;
        this.#logger.error({ err: describeError(error) }, 'Gmail message could not be downloaded');
        throw error;
      }
    });
  }

  /**
   * AttachmentSourcePort: downloads one attachment on demand.
   * Gmail attachment ids are not guaranteed to stay valid, so on 400/404 (or when the part had
   * no attachmentId because its data was inline) the message is re-read and the part located
   * again by Content-ID or filename + MIME type.
   * @param {{ messageId: string, attachment: import('../../domain/entities/Letter.js').AttachmentMeta }} request
   * @returns {Promise<Uint8Array>}
   */
  async fetchAttachment({ messageId, attachment }) {
    if (attachment.attachmentId) {
      try {
        return await this.#downloadAttachment(messageId, attachment.attachmentId);
      } catch (error) {
        const status = httpStatusOf(error);
        if (status !== 400 && status !== 404) throw error;
      }
    }
    let message;
    try {
      message = await this.#call(() => this.#gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' }));
    } catch (error) {
      if (httpStatusOf(error) === 404) throw new AppError('ATTACHMENT_NOT_FOUND', 404, undefined, { messageId });
      throw error;
    }
    const part = findAttachmentPart(message.data.payload, attachment);
    if (!part) throw new AppError('ATTACHMENT_NOT_FOUND', 404, undefined, { messageId, filename: attachment.filename });
    if (part.body?.data) return base64UrlToBytes(part.body.data);
    if (!part.body?.attachmentId) throw new AppError('ATTACHMENT_NOT_FOUND', 404, undefined, { messageId, filename: attachment.filename });
    return this.#downloadAttachment(messageId, part.body.attachmentId);
  }

  /**
   * @param {string} messageId
   * @param {string} attachmentId
   */
  async #downloadAttachment(messageId, attachmentId) {
    const response = await this.#call(() =>
      this.#gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId }),
    );
    return base64UrlToBytes(response.data.data ?? '');
  }

  /**
   * Drafts, spam, trash and messages that are only "sent" are never letters.
   * @param {any} message
   * @returns {boolean}
   */
  /**
   * Query of the full listing: GMAIL_QUERY plus `after:<epoch seconds>` for GMAIL_START_DATE
   * (one second earlier: the exact bound is enforced locally on `internalDate`).
   * @returns {string}
   */
  #listingQuery() {
    if (!this.#startAt) return this.#query;
    const after = `after:${Math.floor(this.#startAt.getTime() / 1000) - 1}`;
    return this.#query ? `(${this.#query}) ${after}` : after;
  }

  #isCandidate(message) {
    const labels = new Set(message.labelIds ?? []);
    for (const label of EXCLUDED_LABELS) if (labels.has(label)) return false;
    if (labels.has('SENT') && !labels.has('INBOX')) return false;
    if (this.#labelId && !labels.has(this.#labelId)) return false;
    if (this.#startAt && Number(message.internalDate ?? Date.now()) < this.#startAt.getTime()) return false;
    return true;
  }
}

/**
 * @param {string} data  base64url
 * @returns {Uint8Array}
 */
function base64UrlToBytes(data) {
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * Finds the MIME part of an attachment by Content-ID, or by filename + MIME type.
 * @param {any} payload
 * @param {import('../../domain/entities/Letter.js').AttachmentMeta} attachment
 * @returns {any | null}
 */
export function findAttachmentPart(payload, attachment) {
  /** @type {any[]} */
  const stack = payload ? [payload] : [];
  /** @type {any | null} */
  let byName = null;
  while (stack.length > 0) {
    const part = stack.shift();
    if (part.parts) stack.push(...part.parts);
    const contentId = (part.headers ?? [])
      .find((/** @type {any} */ h) => h.name?.toLowerCase() === 'content-id')
      ?.value?.replace(/^<|>$/g, '')
      .trim();
    if (attachment.contentId && contentId === attachment.contentId) return part;
    if (!byName && part.filename && part.filename === attachment.filename && (part.mimeType ?? '').toLowerCase() === attachment.mimeType) {
      byName = part;
    }
  }
  return byName;
}

/**
 * Maps a Gmail `format: "full"` message to an IncomingMessage.
 * @param {any} message
 * @returns {import('../../application/ports/MailSourcePort.js').IncomingMessage}
 */
export function toIncomingMessage(message) {
  const headers = headerMap(message.payload);
  const { body, formattedBody, attachments } = extractMessageContent(message.payload);
  const internal = Number(message.internalDate);
  const fromHeaderDate = headers.date ? Date.parse(headers.date) : Number.NaN;
  const receivedAt = Number.isFinite(internal) && internal > 0 ? new Date(internal) : new Date(Number.isNaN(fromHeaderDate) ? 0 : fromHeaderDate);
  return {
    messageId: String(message.id),
    threadId: String(message.threadId ?? ''),
    from: headers.from ?? '',
    to: headers.to ?? '',
    subject: headers.subject ?? '',
    receivedAt,
    body,
    formattedBody,
    attachments,
    headers,
  };
}
