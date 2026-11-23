import { setTimeout as delay } from 'node:timers/promises';

const RETRYABLE_NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ECONNABORTED']);
const RETRYABLE_403_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'backendError']);

/**
 * HTTP status of a googleapis (gaxios) error, if any.
 * @param {unknown} error
 * @returns {number | null}
 */
export function httpStatusOf(error) {
  const e = /** @type {any} */ (error);
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : null);
  return typeof status === 'number' ? status : null;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryable(error) {
  const status = httpStatusOf(error);
  if (status === 429 || (status !== null && status >= 500)) return true;
  if (status === 403) {
    const reasons = /** @type {any} */ (error)?.response?.data?.error?.errors ?? /** @type {any} */ (error)?.errors ?? [];
    if (Array.isArray(reasons) && reasons.some((reason) => RETRYABLE_403_REASONS.has(reason?.reason))) return true;
    // Per-minute quotas ("Quota exceeded for quota metric ...") may come without a reason code.
    return /quota exceeded|rate limit/i.test(String(/** @type {any} */ (error)?.message ?? ''));
  }
  const code = /** @type {any} */ (error)?.code;
  return typeof code === 'string' && RETRYABLE_NETWORK_CODES.has(code);
}

/**
 * Retry-After header (seconds or HTTP date) in milliseconds.
 * @param {unknown} error
 * @param {() => number} now
 * @returns {number | null}
 */
function retryAfterMs(error, now) {
  const headers = /** @type {any} */ (error)?.response?.headers;
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after'];
  if (raw === undefined || raw === null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(String(raw));
  return Number.isNaN(date) ? null : Math.max(0, date - now());
}

/**
 * @typedef {Object} RetryOptions
 * @property {number} [retries]      Extra attempts after the first one (default 5).
 * @property {number} [baseDelayMs]  First backoff delay (default 500 ms).
 * @property {number} [maxDelayMs]   Upper bound for one delay (default 30 s).
 * @property {(ms: number) => Promise<unknown>} [sleep]
 * @property {() => number} [random] 0..1, used for jitter.
 * @property {() => number} [now]
 * @property {(info: { attempt: number, delayMs: number, status: number | null }) => void} [onRetry]
 */

/**
 * Runs `operation`, retrying 429 / 5xx / transient network errors with exponential backoff
 * and full jitter (honouring Retry-After when present).
 * @template T
 * @param {() => Promise<T>} operation
 * @param {RetryOptions} [options]
 * @returns {Promise<T>}
 */
export async function withRetry(operation, options = {}) {
  const {
    retries = 5,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    sleep = (ms) => delay(ms),
    random = Math.random,
    now = Date.now,
    onRetry,
  } = options;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      const hinted = retryAfterMs(error, now);
      const delayMs = Math.min(maxDelayMs, hinted ?? Math.round(exponential / 2 + random() * (exponential / 2)));
      onRetry?.({ attempt: attempt + 1, delayMs, status: httpStatusOf(error) });
      await sleep(delayMs);
    }
  }
}

/**
 * Concurrency cap: at most `concurrency` tasks run at the same time.
 * @param {number} concurrency
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createLimiter(concurrency) {
  const limit = Math.max(1, Math.floor(concurrency));
  let active = 0;
  /** @type {Array<() => void>} */
  const queue = [];
  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (run) run();
  };
  return (task) =>
    new Promise((resolve, reject) => {
      queue.push(() => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
}

/**
 * Maps over items with a concurrency cap, preserving order.
 * @template T, R
 * @param {readonly T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<R>} mapper
 * @returns {Promise<R[]>}
 */
export function mapWithConcurrency(items, concurrency, mapper) {
  const limit = createLimiter(concurrency);
  return Promise.all(items.map((item, index) => limit(() => mapper(item, index))));
}
