/**
 * Turns any thrown value into a short, credential-free message suitable for
 * `sync_state.lastError`, `sync_runs.error` and logs.
 */
import { isAppError } from '../../domain/errors.js';

const MAX_LENGTH = 500;

/**
 * Masks credentials in URIs ("mongodb://user:pass@host" → "mongodb://***@host"),
 * bearer tokens and common secret query parameters.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  return String(text ?? '')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/(bearer\s+)[a-z0-9._~+/-]+=*/gi, '$1***')
    .replace(/((?:access_token|refresh_token|client_secret|token|password|pwd)=)[^&\s]+/gi, '$1***');
}

/**
 * @param {unknown} error
 * @returns {string}
 */
export function describeError(error) {
  let text;
  if (isAppError(error)) {
    text = `${error.code}: ${error.message}`;
  } else if (error instanceof Error) {
    const code = /** @type {{ code?: unknown }} */ (error).code;
    text = code ? `${String(code)}: ${error.message}` : error.message || error.name;
  } else {
    text = String(error ?? 'Unknown error');
  }
  const redacted = redactSecrets(text).replace(/\s+/g, ' ').trim() || 'Unknown error';
  return redacted.length > MAX_LENGTH ? `${redacted.slice(0, MAX_LENGTH - 1)}…` : redacted;
}
