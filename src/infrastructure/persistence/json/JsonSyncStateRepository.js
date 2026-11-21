import { DEFAULTS, SYNC_STATE_ID } from '../../../domain/constants.js';
import { createSyncRun } from '../../../domain/entities/SyncRun.js';
import { canAcquireLock, createSyncState } from '../../../domain/entities/SyncState.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

const DEFAULT_MAX_RUNS = 500;

/**
 * JSON / in-memory implementation of SyncStateRepositoryPort.
 * The lock is atomic within one process (writes are serialized).
 * @implements {import('../../../application/ports/SyncStateRepositoryPort.js').SyncStateRepositoryPort}
 */
export class JsonSyncStateRepository {
  #state;
  #runs;
  #clock;
  #runsTtlDays;
  #maxRuns;

  /**
   * @param {{
   *   stateFilePath?: string | null,
   *   runsFilePath?: string | null,
   *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
   *   runsTtlDays?: number,
   *   maxRuns?: number,
   * }} options
   */
  constructor({ stateFilePath = null, runsFilePath = null, clock, runsTtlDays = 90, maxRuns = DEFAULT_MAX_RUNS }) {
    this.#state = new JsonDocumentStore({ filePath: stateFilePath, idField: 'id' });
    this.#runs = new JsonDocumentStore({ filePath: runsFilePath, idField: 'id' });
    this.#clock = clock;
    this.#runsTtlDays = runsTtlDays;
    this.#maxRuns = maxRuns;
  }

  /**
   * @param {ReadonlyMap<string, Record<string, any>>} documents
   */
  #current(documents) {
    return createSyncState(documents.get(SYNC_STATE_ID) ?? { id: SYNC_STATE_ID });
  }

  get() {
    return this.#state.read((documents) => this.#current(documents));
  }

  /** @param {import('../../../domain/entities/SyncState.js').SyncState} state */
  async save(state) {
    await this.#state.write((documents) => {
      const stored = documents.get(SYNC_STATE_ID);
      documents.set(SYNC_STATE_ID, { ...toPlain(createSyncState(state)), id: SYNC_STATE_ID, lock: stored?.lock ?? null });
    });
  }

  /**
   * @param {string} owner
   * @param {number} [ttlSeconds]
   */
  acquireLock(owner, ttlSeconds = DEFAULTS.SYNC_LOCK_TTL_SECONDS) {
    return this.#state.write((documents) => {
      const now = this.#clock.now();
      const current = this.#current(documents);
      if (!canAcquireLock(current, owner, now)) return false;
      const expiresAt = new Date(now.getTime() + Math.max(1, ttlSeconds) * 1000).toISOString();
      documents.set(SYNC_STATE_ID, { ...toPlain(current), id: SYNC_STATE_ID, lock: { owner, expiresAt } });
      return true;
    });
  }

  /** @param {string} owner */
  releaseLock(owner) {
    return this.#state.write((documents) => {
      const stored = documents.get(SYNC_STATE_ID);
      if (!stored?.lock || stored.lock.owner !== owner) return false;
      documents.set(SYNC_STATE_ID, { ...stored, lock: null });
      return true;
    });
  }

  /** @param {import('../../../domain/entities/SyncRun.js').SyncRun} run */
  async appendRun(run) {
    await this.#runs.write((documents) => {
      documents.set(run.id, toPlain(createSyncRun(run)));
      const cutoff = this.#clock.now().getTime() - this.#runsTtlDays * 24 * 60 * 60 * 1000;
      const ordered = [...documents.values()].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
      ordered.forEach((document, index) => {
        if (Date.parse(document.startedAt) < cutoff || index >= this.#maxRuns) documents.delete(document.id);
      });
    });
  }

  /** @param {number} [limit] */
  listRuns(limit = 20) {
    return this.#runs.read((documents) =>
      [...documents.values()]
        .map((document) => createSyncRun(document))
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
        .slice(0, limit),
    );
  }

  async deleteAll() {
    await this.#state.write((documents) => documents.clear());
    await this.#runs.write((documents) => documents.clear());
  }
}
