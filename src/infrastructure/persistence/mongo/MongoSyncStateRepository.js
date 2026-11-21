import { DEFAULTS, SYNC_STATE_ID } from '../../../domain/constants.js';
import { COLLECTIONS } from './collections.js';
import { syncRunFromDocument, syncRunToDocument, syncStateFields, syncStateFromDocument } from './mappers.js';

const DUPLICATE_KEY = 11000;

/**
 * MongoDB implementation of SyncStateRepositoryPort: single `sync_state` document
 * (`_id: "gmail"`) plus the `sync_runs` history (TTL index on `startedAt`).
 * @implements {import('../../../application/ports/SyncStateRepositoryPort.js').SyncStateRepositoryPort}
 */
export class MongoSyncStateRepository {
  /** @type {import('mongodb').Collection<any>} */
  #state;
  /** @type {import('mongodb').Collection<any>} */
  #runs;
  #clock;

  /**
   * @param {import('mongodb').Db} db
   * @param {{ clock: import('../../../application/ports/ClockPort.js').ClockPort }} options
   */
  constructor(db, { clock }) {
    this.#state = db.collection(COLLECTIONS.SYNC_STATE);
    this.#runs = db.collection(COLLECTIONS.SYNC_RUNS);
    this.#clock = clock;
  }

  async get() {
    return syncStateFromDocument(await this.#state.findOne({ _id: SYNC_STATE_ID }));
  }

  /**
   * Persists every field except `lock`.
   * @param {import('../../../domain/entities/SyncState.js').SyncState} state
   */
  async save(state) {
    await this.#state.updateOne({ _id: SYNC_STATE_ID }, { $set: syncStateFields(state) }, { upsert: true });
  }

  /**
   * Atomic lock: a single `findOneAndUpdate` whose filter accepts a missing lock, an expired
   * lock or a lock already held by `owner`. When the document exists but the lock is held by
   * someone else, the upsert collides on `_id` and the attempt is refused.
   * @param {string} owner
   * @param {number} [ttlSeconds]
   */
  async acquireLock(owner, ttlSeconds = DEFAULTS.SYNC_LOCK_TTL_SECONDS) {
    const now = this.#clock.now();
    const expiresAt = new Date(now.getTime() + Math.max(1, ttlSeconds) * 1000);
    try {
      const document = await this.#state.findOneAndUpdate(
        {
          _id: SYNC_STATE_ID,
          $or: [{ lock: null }, { 'lock.expiresAt': { $lte: now } }, { 'lock.owner': owner }],
        },
        { $set: { lock: { owner, expiresAt } } },
        { upsert: true, returnDocument: 'after' },
      );
      return document?.lock?.owner === owner;
    } catch (error) {
      if (/** @type {{ code?: number }} */ (error).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  /** @param {string} owner */
  async releaseLock(owner) {
    const result = await this.#state.updateOne({ _id: SYNC_STATE_ID, 'lock.owner': owner }, { $set: { lock: null } });
    return result.modifiedCount === 1;
  }

  /** @param {import('../../../domain/entities/SyncRun.js').SyncRun} run */
  async appendRun(run) {
    const document = syncRunToDocument(run);
    await this.#runs.replaceOne({ _id: document._id }, document, { upsert: true });
  }

  /** @param {number} [limit] */
  async listRuns(limit = 20) {
    const documents = await this.#runs.find({}).sort({ startedAt: -1, _id: -1 }).limit(limit).toArray();
    return documents.map(syncRunFromDocument);
  }

  async deleteAll() {
    await this.#state.deleteMany({});
    await this.#runs.deleteMany({});
  }
}
