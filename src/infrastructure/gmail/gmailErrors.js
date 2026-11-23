import { AppError } from '../../domain/errors.js';
import { httpStatusOf } from './retry.js';

const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ECONNABORTED']);

/**
 * @param {any} error
 * @returns {string[]}
 */
function reasonsOf(error) {
  const list = error?.response?.data?.error?.errors ?? error?.errors ?? [];
  return Array.isArray(list) ? list.map((item) => String(item?.reason ?? '')) : [];
}

/**
 * Translates googleapis failures into AppErrors with a clear, actionable Spanish message:
 * - GMAIL_AUTH_ERROR: expired / revoked / invalid credentials (401, invalid_grant);
 * - GMAIL_INSUFFICIENT_PERMISSIONS: the token lacks the required scope (403);
 * - GMAIL_UNAVAILABLE: network failure, quota or server error after retries.
 * Returns null for any other error (for example 404 "not found"), which the caller handles.
 * @param {unknown} error
 * @returns {AppError | null}
 */
export function mapGmailError(error) {
  if (error instanceof AppError) return null;
  const e = /** @type {any} */ (error);
  const status = httpStatusOf(error);
  const reasons = reasonsOf(e);
  const text = String(e?.response?.data?.error ?? e?.message ?? '');
  if (status === 401 || /invalid_grant|invalid_client|unauthorized_client/i.test(text)) {
    return new AppError('GMAIL_AUTH_ERROR', 401, undefined, { cause: 'authentication rejected by Google' });
  }
  if (status === 403 && (reasons.includes('insufficientPermissions') || /insufficient (authentication )?scopes?|insufficient permission/i.test(text))) {
    return new AppError('GMAIL_INSUFFICIENT_PERMISSIONS', 403, undefined, { cause: 'token without the required Gmail scope' });
  }
  if (status === 429 || (status !== null && status >= 500) || (typeof e?.code === 'string' && NETWORK_CODES.has(e.code))) {
    return new AppError('GMAIL_UNAVAILABLE', 503, undefined, { cause: status ? `HTTP ${status}` : String(e?.code ?? 'network') });
  }
  return null;
}
