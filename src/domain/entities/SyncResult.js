import { assertSyncMode } from './SyncRun.js';

/**
 * @typedef {Object} ParticipantDelta
 * @property {string} participantId
 * @property {number} newLetters
 */

/** Why a synchronization ran as a full listing. */
export const FullSyncReason = Object.freeze({
  REQUESTED: 'requested',
  FIRST_SYNC: 'first-sync',
  CURSOR_EXPIRED: 'cursor-expired',
  SELECTION_CHANGED: 'selection-changed',
});
const FULL_SYNC_REASONS = new Set(Object.values(FullSyncReason));

/**
 * Outcome of a successful synchronization.
 * @typedef {Object} SyncResult
 * @property {string}             mode                  Mode actually executed.
 * @property {string}             requestedMode         Mode requested by the caller.
 * @property {boolean}            fallbackToFull        True when an incremental request ran as a full sync.
 * @property {string|null}        fullSyncReason        Why a full sync ran (see FullSyncReason), null for incrementals.
 * @property {number}             added
 * @property {number}             updated
 * @property {number}             unchanged
 * @property {number}             deleted
 * @property {ParticipantDelta[]} perParticipantDeltas
 * @property {number}             durationMs
 * @property {string|null}        syncRunId
 */

/**
 * @param {unknown} value
 * @returns {number}
 */
function count(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : 0;
}

/**
 * @param {Partial<SyncResult> & { mode: string }} props
 * @returns {Readonly<SyncResult>}
 */
export function createSyncResult(props) {
  const source = props ?? /** @type {any} */ ({});
  const mode = assertSyncMode(source.mode);
  const requestedMode = assertSyncMode(source.requestedMode ?? mode);
  return Object.freeze({
    mode,
    requestedMode,
    fallbackToFull: source.fallbackToFull ?? requestedMode !== mode,
    fullSyncReason: mode === 'full' && FULL_SYNC_REASONS.has(/** @type {string} */ (source.fullSyncReason)) ? /** @type {string} */ (source.fullSyncReason) : null,
    added: count(source.added),
    updated: count(source.updated),
    unchanged: count(source.unchanged),
    deleted: count(source.deleted),
    perParticipantDeltas: Object.freeze(
      (source.perParticipantDeltas ?? []).map((delta) =>
        Object.freeze({ participantId: String(delta.participantId), newLetters: count(delta.newLetters) }),
      ),
    ),
    durationMs: count(source.durationMs),
    syncRunId: source.syncRunId ?? null,
  });
}
