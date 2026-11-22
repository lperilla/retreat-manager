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
  /** Without messageIds: every letter of the participants; with them: only those letters. */
  updatePrintStatus: (/** @type {string[]} */ participantIds, /** @type {string} */ status, /** @type {string[] | undefined} */ messageIds = undefined) =>
    request('/api/print-status', { method: 'POST', body: { participantIds, status, ...(messageIds ? { messageIds } : {}) } }),
  newLetters: () => request('/api/letters/new'),
  markSeen: (/** @type {{ participantId?: string, messageIds?: string[] }} */ body = {}) =>
    request('/api/letters/seen', { method: 'POST', body }),
  /** "Marcar como no leída": the letters show up as new again. */
  markUnseen: (/** @type {string[]} */ messageIds) => request('/api/letters/seen', { method: 'POST', body: { messageIds, seen: false } }),
  reviewQueue: () => request('/api/review'),
  assign: (/** @type {string} */ messageId, /** @type {string[]} */ participantIds) =>
    request(`/api/review/${encodeURIComponent(messageId)}/assign`, { method: 'POST', body: { participantIds } }),
  unassign: (/** @type {string} */ messageId) =>
    request(`/api/review/${encodeURIComponent(messageId)}/unassign`, { method: 'POST' }),
  resetAssignment: (/** @type {string} */ messageId) =>
    request(`/api/review/${encodeURIComponent(messageId)}/reset`, { method: 'POST' }),
  recompute: () => request('/api/assignments/recompute', { method: 'POST' }),
  // Participants module
  catalogs: () => request('/api/catalogs'),
  participants: (/** @type {{ q?: string, filter?: string }} */ params = {}) => request(`/api/participants${query(params)}`),
  participant: (/** @type {string} */ id) => request(`/api/participants/${encodeURIComponent(id)}`),
  createParticipant: (/** @type {Record<string, unknown>} */ body) => request('/api/participants', { method: 'POST', body }),
  quickAddParticipant: (/** @type {{ givenNames: string, firstSurname: string, secondSurname?: string, aliases?: string[] }} */ body) =>
    request('/api/participants', { method: 'POST', body: { ...body, quick: true } }),
  updateParticipant: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ body) =>
    request(`/api/participants/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  setAttendance: (/** @type {string} */ id, /** @type {boolean} */ confirmed) =>
    request(`/api/participants/${encodeURIComponent(id)}/attendance`, { method: 'PUT', body: { confirmed } }),
  withdrawParticipant: (/** @type {string} */ id) => request(`/api/participants/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),
  reactivateParticipant: (/** @type {string} */ id) => request(`/api/participants/${encodeURIComponent(id)}/reactivate`, { method: 'POST' }),
  deleteParticipant: (/** @type {string} */ id) => request(`/api/participants/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  retreat: () => request('/api/retreat'),
  // Accommodation module (rooms and tables)
  accommodation: () => request('/api/accommodation'),
  createRoom: (/** @type {Record<string, unknown>} */ body) => request('/api/rooms', { method: 'POST', body }),
  updateRoom: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ body) => request(`/api/rooms/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteRoom: (/** @type {string} */ id) => request(`/api/rooms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  createTable: (/** @type {Record<string, unknown>} */ body) => request('/api/tables', { method: 'POST', body }),
  updateTable: (/** @type {string} */ id, /** @type {Record<string, unknown>} */ body) => request(`/api/tables/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteTable: (/** @type {string} */ id) => request(`/api/tables/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  assignRoom: (/** @type {string} */ participantId, /** @type {string | null} */ roomId, /** @type {string | null} */ bed = null) =>
    request(`/api/participants/${encodeURIComponent(participantId)}/room`, { method: 'PUT', body: { roomId, bed } }),
  assignTable: (/** @type {string} */ participantId, /** @type {string | null} */ tableId) =>
    request(`/api/participants/${encodeURIComponent(participantId)}/table`, { method: 'PUT', body: { tableId } }),
  updateRetreat: (/** @type {{ name: string, startDate: string | null, endDate: string | null }} */ body) => request('/api/retreat', { method: 'PUT', body }),
  closeRetreat: (/** @type {string} */ confirmName) => request('/api/retreat/close', { method: 'POST', body: { confirmName } }),
  startSync: (/** @type {'incremental' | 'full'} */ mode) => request('/api/sync', { method: 'POST', body: { mode } }),
  syncStatus: () => request('/api/sync/status'),
  syncRuns: (limit = 50) => request(`/api/sync/runs${query({ limit })}`),
  createExport: (/** @type {{ participantIds: string[], format: string, afterDate?: string | null, includeAttachments?: boolean, originalFormat?: boolean }} */ body) =>
    request('/api/exports', { method: 'POST', body }),
  attachmentText: (/** @type {string} */ messageId, /** @type {number} */ index) =>
    request(`/api/letters/${encodeURIComponent(messageId)}/attachments/${index}/text`),
};
