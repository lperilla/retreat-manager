import { SyncMode, SyncRunStatus } from '../constants.js';
import { AppError } from '../errors.js';

/**
 * History entry for one synchronization attempt.
 * @typedef {Object} SyncRun
 * @property {string}      id
 * @property {string}      type        'incremental' | 'full' (the mode actually executed)
 * @property {Date}        startedAt
 * @property {Date|null}   finishedAt
 * @property {string}      status      'running' | 'success' | 'failed'
 * @property {number}      added
 * @property {number}      updated
 * @property {number}      deleted
 * @property {string|null} error
 * @property {number|null} durationMs
 */

const MODES = new Set(Object.values(SyncMode));
const STATUSES = new Set(Object.values(SyncRunStatus));

/**
 * @param {unknown} mode
 * @returns {string}
 */
export function assertSyncMode(mode) {
  if (typeof mode !== 'string' || !MODES.has(mode)) {
    throw new AppError('INVALID_SYNC_MODE', 400, undefined, { mode });
  }
  return mode;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Date}
 */
function toDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(/** @type {any} */ (value));
  if (value === undefined || value === null || Number.isNaN(date.getTime())) {
    throw new AppError('INVALID_SYNC_STATE', 400, undefined, { reason: `${field} must be a valid date` });
  }
  return date;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function count(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

/**
 * @param {Partial<SyncRun> & { id: string, type: string, startedAt: Date | string | number }} props
 * @returns {Readonly<SyncRun>}
 */
export function createSyncRun(props) {
  const source = props ?? /** @type {any} */ ({});
  if (typeof source.id !== 'string' || source.id.length === 0) {
    throw new AppError('INVALID_SYNC_STATE', 400, undefined, { reason: 'syncRun.id is required' });
  }
  const status = source.status ?? SyncRunStatus.RUNNING;
  if (!STATUSES.has(status)) {
    throw new AppError('INVALID_SYNC_STATE', 400, undefined, { reason: `unknown run status "${status}"` });
  }
  const startedAt = toDate(source.startedAt, 'startedAt');
  const finishedAt = source.finishedAt ? toDate(source.finishedAt, 'finishedAt') : null;
  return Object.freeze({
    id: source.id,
    type: assertSyncMode(source.type),
    startedAt,
    finishedAt,
    status,
    added: count(source.added),
    updated: count(source.updated),
    deleted: count(source.deleted),
    error: source.error ? String(source.error) : null,
    durationMs: finishedAt ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : null,
  });
}

/**
 * @param {SyncRun} run
 * @param {{ finishedAt: Date, added?: number, updated?: number, deleted?: number, type?: string }} result
 * @returns {Readonly<SyncRun>}
 */
export function completeSyncRun(run, { finishedAt, added = 0, updated = 0, deleted = 0, type }) {
  return createSyncRun({
    ...run,
    type: type ?? run.type,
    status: SyncRunStatus.SUCCESS,
    finishedAt,
    added,
    updated,
    deleted,
    error: null,
  });
}

/**
 * @param {SyncRun} run
 * @param {{ finishedAt: Date, error: string, type?: string }} failure
 * @returns {Readonly<SyncRun>}
 */
export function failSyncRun(run, { finishedAt, error, type }) {
  return createSyncRun({
    ...run,
    type: type ?? run.type,
    status: SyncRunStatus.FAILED,
    finishedAt,
    error: error || 'Unknown error',
  });
}
