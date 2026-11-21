import { SyncStatus } from '../../domain/constants.js';
import { cooldownRemainingSeconds, isLockActive } from '../../domain/entities/SyncState.js';
import { presentSyncResult, toIso } from './presenters.js';

/** Shown when a run died without recording its outcome (process killed, lock expired). */
export const INTERRUPTED_SYNC_MESSAGE = 'La sincronización se interrumpió antes de terminar.';

/**
 * @typedef {Object} SyncStatusView
 * @property {string}      status                    'idle' | 'running' | 'failed'
 * @property {boolean}     running
 * @property {boolean}     lastSyncFailed
 * @property {string|null} lastError
 * @property {string|null} lastAttemptAt
 * @property {string|null} lastSuccessAt
 * @property {string|null} lastFullSyncAt
 * @property {ReturnType<typeof presentSyncResult>} lastResult
 * @property {boolean}     hasCursor
 * @property {number}      cooldownRemainingSeconds
 * @property {boolean}     canSync
 */

/**
 * Effective sync status: an active lock means "running"; a persisted "running" status
 * without an active lock means the run was interrupted and is reported as failed.
 * @param {import('../../domain/entities/SyncState.js').SyncState} state
 * @param {{ now: Date, minIntervalSeconds: number, participantsById?: Map<string, import('../../domain/entities/Participant.js').Participant> }} context
 * @returns {SyncStatusView}
 */
export function buildSyncStatusView(state, { now, minIntervalSeconds, participantsById = new Map() }) {
  const running = isLockActive(state.lock, now);
  let status = state.status;
  let lastError = state.lastError;
  if (running) {
    status = SyncStatus.RUNNING;
  } else if (status === SyncStatus.RUNNING) {
    status = SyncStatus.FAILED;
    lastError = lastError ?? INTERRUPTED_SYNC_MESSAGE;
  }
  const cooldown = cooldownRemainingSeconds(state, now, minIntervalSeconds);
  return {
    status,
    running,
    lastSyncFailed: status === SyncStatus.FAILED,
    lastError: status === SyncStatus.FAILED ? lastError : null,
    lastAttemptAt: toIso(state.lastAttemptAt),
    lastSuccessAt: toIso(state.lastSuccessAt),
    lastFullSyncAt: toIso(state.lastFullSyncAt),
    lastResult: presentSyncResult(state.lastResult, participantsById),
    hasCursor: Boolean(state.historyId),
    cooldownRemainingSeconds: cooldown,
    canSync: !running && cooldown === 0,
  };
}
