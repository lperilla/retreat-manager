/**
 * JSON API client. Errors carry the server's `{ code, message }` (message in Spanish).
 */
export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {{ code?: string, message?: string, retryAfterSeconds?: number }} body
   */
  constructor(status, body) {
    super(body.message || 'Se ha producido un error inesperado.');
    this.status = status;
    this.code = body.code || 'INTERNAL_ERROR';
    this.retryAfterSeconds = body.retryAfterSeconds ?? null;
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: unknown }} [options]
 */
async function request(path, { method = 'GET', body } = {}) {
  /** @type {RequestInit} */
  const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (method !== 'GET') {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body ?? {});
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ApiError(0, { code: 'NETWORK_ERROR', message: 'No se puede conectar con el servidor. Comprueba la conexión.' });
  }
  if (response.status === 401) {
    window.location.assign('/login');
    throw new ApiError(401, { code: 'UNAUTHORIZED', message: 'Sesión caducada.' });
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data);
  return data;
}

/** @param {Record<string, string | number | null | undefined>} params */
function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  appInfo: () => request('/api/app-info'),
  enableDemo: () => request('/api/demo/enable', { method: 'POST' }),
  dashboard: () => request('/api/dashboard'),
  participantLetters: (/** @type {string} */ id, /** @type {string | null} */ afterDate) =>
    request(`/api/participants/${encodeURIComponent(id)}/letters${query({ afterDate })}`),
  updatePrintStatus: (/** @type {string[]} */ participantIds, /** @type {string} */ status) =>
    request('/api/print-status', { method: 'POST', body: { participantIds, status } }),
  newLetters: () => request('/api/letters/new'),
  markSeen: (/** @type {{ participantId?: string, messageIds?: string[] }} */ body = {}) =>
    request('/api/letters/seen', { method: 'POST', body }),
  reviewQueue: () => request('/api/review'),
  assign: (/** @type {string} */ messageId, /** @type {string[]} */ participantIds) =>
    request(`/api/review/${encodeURIComponent(messageId)}/assign`, { method: 'POST', body: { participantIds } }),
  unassign: (/** @type {string} */ messageId) =>
    request(`/api/review/${encodeURIComponent(messageId)}/unassign`, { method: 'POST' }),
  resetAssignment: (/** @type {string} */ messageId) =>
    request(`/api/review/${encodeURIComponent(messageId)}/reset`, { method: 'POST' }),
  recompute: () => request('/api/assignments/recompute', { method: 'POST' }),
  startSync: (/** @type {'incremental' | 'full'} */ mode) => request('/api/sync', { method: 'POST', body: { mode } }),
  syncStatus: () => request('/api/sync/status'),
  syncRuns: (limit = 50) => request(`/api/sync/runs${query({ limit })}`),
  createExport: (/** @type {{ participantIds: string[], format: string, afterDate?: string | null, includeAttachments?: boolean }} */ body) =>
    request('/api/exports', { method: 'POST', body }),
  attachmentText: (/** @type {string} */ messageId, /** @type {number} */ index) =>
    request(`/api/letters/${encodeURIComponent(messageId)}/attachments/${index}/text`),
};
