import { SYNC_STATE_ID, SyncMode, SyncStatus } from '../constants.js';
import { AppError } from '../errors.js';
import { createSyncResult } from './SyncResult.js';

/**
 * @typedef {Object} SyncLock
 * @property {string} owner
 * @property {Date}   expiresAt
 */

/**
 * Single persisted synchronization state (document `_id: "gmail"`).
 * @typedef {Object} SyncState
 * @property {string}           id
 * @property {string|null}      historyId       Cursor for incremental sync.
 * @property {Date|null}        lastAttemptAt
 * @property {Date|null}        lastSuccessAt
 * @property {Date|null}        lastFullSyncAt
 * @property {string}           status          'idle' | 'running' | 'failed'
 * @property {string|null}      lastError
 * @property {import('./SyncResult.js').SyncResult|null} lastResult
 * @property {SyncLock|null}    lock
 */

const STATUSES = new Set(Object.values(SyncStatus));

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Date|null}
 */
function optionalDate(value, field) {
  if (value === undefined || value === null) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(/** @type {any} */ (value));
  if (Number.isNaN(date.getTime())) {
    throw new AppError('INVALID_SYNC_STATE', 400, undefined, { reason: `${field} must be a valid date` });
  }
  return date;
}

/**
 * @param {unknown} lock
 * @returns {Readonly<SyncLock>|null}
 */
function createLock(lock) {
  if (!lock || typeof lock !== 'object') return null;
  const { owner, expiresAt } = /** @type {any} */ (lock);
  if (typeof owner !== 'string' || owner.length === 0) return null;
  const date = optionalDate(expiresAt, 'lock.expiresAt');
  if (!date) return null;
  return Object.freeze({ owner, expiresAt: date });
}

/**
 * @param {Partial<SyncState>} [props]
 * @returns {Readonly<SyncState>}
 */
export function createSyncState(props = {}) {
  const status = props.status ?? SyncStatus.IDLE;
  if (!STATUSES.has(status)) {
    throw new AppError('INVALID_SYNC_STATE', 400, undefined, { reason: `unknown status "${status}"` });
  }
  return Object.freeze({
    id: props.id ?? SYNC_STATE_ID,
    historyId: props.historyId ? String(props.historyId) : null,
    lastAttemptAt: optionalDate(props.lastAttemptAt, 'lastAttemptAt'),
    lastSuccessAt: optionalDate(props.lastSuccessAt, 'lastSuccessAt'),
    lastFullSyncAt: optionalDate(props.lastFullSyncAt, 'lastFullSyncAt'),
    status,
    lastError: props.lastError ? String(props.lastError) : null,
    lastResult: props.lastResult ? createSyncResult(props.lastResult) : null,
    lock: createLock(props.lock),
  });
}

/**
 * @param {SyncLock|null|undefined} lock
 * @param {Date} now
 * @returns {boolean}
 */
export function isLockActive(lock, now) {
  return Boolean(lock && lock.owner && lock.expiresAt.getTime() > now.getTime());
}

/**
 * The lock can be taken when it is missing, expired, or already held by `owner`.
 * @param {SyncState} state
 * @param {string} owner
 * @param {Date} now
 * @returns {boolean}
 */
export function canAcquireLock(state, owner, now) {
  return !isLockActive(state.lock, now) || state.lock?.owner === owner;
}

/**
 * @param {SyncState} state
 * @param {string} owner
 * @param {Date} now
 * @param {number} ttlSeconds
 * @returns {Readonly<SyncState>}
 */
export function withLockAcquired(state, owner, now, ttlSeconds) {
  if (!canAcquireLock(state, owner, now)) {
    throw new AppError('SYNC_IN_PROGRESS', 409, undefined, { lockOwner: state.lock?.owner });
  }
  return createSyncState({
    ...state,
    lock: { owner, expiresAt: new Date(now.getTime() + Math.max(1, ttlSeconds) * 1000) },
  });
}

/**
 * Releases the lock only if `owner` holds it.
 * @param {SyncState} state
 * @param {string} owner
 * @returns {Readonly<SyncState>}
 */
export function withLockReleased(state, owner) {
  if (state.lock?.owner !== owner) return state;
  return createSyncState({ ...state, lock: null });
}

/**
 * Seconds to wait before another sync may start (0 when allowed).
 * @param {SyncState} state
 * @param {Date} now
 * @param {number} minIntervalSeconds
 * @returns {number}
 */
export function cooldownRemainingSeconds(state, now, minIntervalSeconds) {
  if (!state.lastAttemptAt || minIntervalSeconds <= 0) return 0;
  const elapsedMs = now.getTime() - state.lastAttemptAt.getTime();
  const remainingMs = minIntervalSeconds * 1000 - elapsedMs;
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/**
 * @param {SyncState} state
 * @param {{ now: Date }} context
 * @returns {Readonly<SyncState>}
 */
export function markSyncStarted(state, { now }) {
  return createSyncState({ ...state, status: SyncStatus.RUNNING, lastAttemptAt: now });
}

/**
 * Advances the cursor. Call ONLY after the batch has been persisted successfully.
 * @param {SyncState} state
 * @param {{ now: Date, nextCursor: string | null, result: import('./SyncResult.js').SyncResult }} context
 * @returns {Readonly<SyncState>}
 */
export function markSyncSucceeded(state, { now, nextCursor, result }) {
  return createSyncState({
    ...state,
    historyId: nextCursor ?? state.historyId,
    lastSuccessAt: now,
    lastFullSyncAt: result.mode === SyncMode.FULL ? now : state.lastFullSyncAt,
    status: SyncStatus.IDLE,
    lastError: null,
    lastResult: result,
  });
}

/**
 * Keeps the previous cursor and the last good result.
 * @param {SyncState} state
 * @param {{ now: Date, error: string }} context
 * @returns {Readonly<SyncState>}
 */
export function markSyncFailed(state, { now, error }) {
  return createSyncState({
    ...state,
    status: SyncStatus.FAILED,
    lastAttemptAt: state.lastAttemptAt ?? now,
    lastError: error || 'Unknown error',
  });
}
