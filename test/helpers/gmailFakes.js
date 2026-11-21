/**
 * Fake Gmail API (subset of googleapis `gmail.users`) and message builders. No network.
 */

/** @param {string} text */
export const b64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

/**
 * Builds a Gmail `format: "full"` message.
 * @param {string} id
 * @param {{
 *   labels?: string[], subject?: string, from?: string, to?: string, text?: string, html?: string,
 *   internalDate?: string, headers?: Array<{ name: string, value: string }>, attachments?: any[], threadId?: string,
 * }} [options]
 */
export function gmailMessage(id, options = {}) {
  const {
    labels = ['INBOX'],
    subject = `Carta ${id}`,
    from = 'Familia <familia@example.com>',
    to = 'Cartas Retiro <cartas@example.com>',
    text,
    html,
    internalDate = '1795251600000',
    headers = [],
    attachments = [],
    threadId = `t-${id}`,
  } = options;
  const bodyParts = [];
  if (text !== undefined) bodyParts.push({ mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=UTF-8' }], body: { data: b64url(text), size: text.length } });
  if (html !== undefined) bodyParts.push({ mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { data: b64url(html), size: html.length } });
  const alternative = { mimeType: 'multipart/alternative', parts: bodyParts };
  return {
    id,
    threadId,
    labelIds: labels,
    internalDate,
    payload: {
      mimeType: 'multipart/mixed',
      headers: [
        { name: 'From', value: from },
        { name: 'To', value: to },
        { name: 'Subject', value: subject },
        { name: 'Date', value: 'Fri, 20 Nov 2026 10:00:00 +0100' },
        ...headers,
      ],
      parts: [alternative, ...attachments],
    },
  };
}

/**
 * @param {number} status
 * @param {Record<string, string>} [headers]
 */
export function httpError(status, headers = {}) {
  const error = new Error(`HTTP ${status}`);
  Object.assign(error, { status, code: status, response: { status, headers, data: {} } });
  return error;
}

/**
 * @param {{
 *   historyId?: string,
 *   listPages?: Record<string, Array<{ ids: string[], next?: string }>>,
 *   messages?: Record<string, any>,
 *   historyPages?: Array<{ history?: any[], historyId?: string, next?: string }>,
 *   historyErrors?: unknown[],
 *   getErrors?: Record<string, unknown>,
 *   getDelayMs?: number,
 *   attachments?: Record<string, string>,
 * }} setup
 */
export function fakeGmail(setup) {
  const {
    historyId = '900',
    listPages = {},
    messages = {},
    historyPages = [],
    historyErrors = [],
    getErrors = {},
    getDelayMs = 0,
    attachments = {},
  } = setup;
  /** @type {Array<[string, any]>} */
  const calls = [];
  const stats = { active: 0, maxActive: 0 };
  const pageIndex = (/** @type {string | undefined} */ token) => (token ? Number(token.replace('page-', '')) : 0);

  return {
    calls,
    stats,
    users: {
      async getProfile(params) {
        calls.push(['getProfile', params]);
        return { data: { historyId, emailAddress: 'cartas@example.com' } };
      },
      messages: {
        async list(params) {
          calls.push(['messages.list', params]);
          const key = params.q ?? '';
          const pages = listPages[key] ?? Object.values(listPages).find((_, i, arr) => arr.length === 1 && key.startsWith('(')) ?? [{ ids: [] }];
          const page = pages[pageIndex(params.pageToken)] ?? { ids: [] };
          return { data: { messages: page.ids.map((id) => ({ id, threadId: `t-${id}` })), nextPageToken: page.next } };
        },
        async get(params) {
          calls.push(['messages.get', params]);
          stats.active += 1;
          stats.maxActive = Math.max(stats.maxActive, stats.active);
          try {
            if (getDelayMs) await new Promise((resolve) => setTimeout(resolve, getDelayMs));
            if (getErrors[params.id]) throw getErrors[params.id];
            if (!messages[params.id]) throw httpError(404);
            return { data: messages[params.id] };
          } finally {
            stats.active -= 1;
          }
        },
        attachments: {
          async get(params) {
            calls.push(['attachments.get', params]);
            const data = attachments[params.id];
            if (data === undefined) throw httpError(404);
            return { data: { data, size: data.length } };
          },
        },
      },
      history: {
        async list(params) {
          calls.push(['history.list', params]);
          if (historyErrors.length > 0) throw historyErrors.shift();
          const page = historyPages[pageIndex(params.pageToken)] ?? {};
          return { data: { history: page.history, historyId: page.historyId, nextPageToken: page.next } };
        },
      },
    },
  };
}
