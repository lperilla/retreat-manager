import { definePort } from './definePort.js';

/**
 * Persistence of the single sync state document and of the sync run history.
 *
 * - `save` persists every field EXCEPT `lock`, which is only changed by
 *   `acquireLock` / `releaseLock` (so saving progress never steals or drops a lock).
 * - `acquireLock` is atomic: it succeeds when the lock is missing, expired, or already
 *   held by `owner` (which renews it), and returns false otherwise.
 * - `releaseLock` only releases a lock held by `owner`.
 *
 * @typedef {import('../../domain/entities/SyncState.js').SyncState} SyncState
 * @typedef {import('../../domain/entities/SyncRun.js').SyncRun} SyncRun
 *
 * @typedef {Object} SyncStateRepositoryPort
 * @property {() => Promise<SyncState>} get
 * @property {(state: SyncState) => Promise<void>} save
 * @property {(owner: string, ttlSeconds: number) => Promise<boolean>} acquireLock
 * @property {(owner: string) => Promise<boolean>} releaseLock
 * @property {(run: SyncRun) => Promise<void>} appendRun
 * @property {(limit?: number) => Promise<SyncRun[]>} listRuns  Most recent first.
 * @property {() => Promise<void>} deleteAll
 */

export const SyncStateRepositoryPort = definePort('SyncStateRepositoryPort', [
  'get',
  'save',
  'acquireLock',
  'releaseLock',
  'appendRun',
  'listRuns',
  'deleteAll',
]);
