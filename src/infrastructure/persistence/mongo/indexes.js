import { COLLECTIONS } from './collections.js';

/** Code returned when an index with the same name exists with different options. */
const INDEX_OPTIONS_CONFLICT = 85;

/**
 * @typedef {Object} IndexSpec
 * @property {string} collection
 * @property {Record<string, 1 | -1>} key
 * @property {string} name
 * @property {number} [expireAfterSeconds]
 */

/**
 * Index definitions. The TTL of `sync_runs` comes from SYNC_RUNS_TTL_DAYS.
 * @param {{ runsTtlDays: number }} options
 * @returns {IndexSpec[]}
 */
export function indexSpecs({ runsTtlDays }) {
  return [
    { collection: COLLECTIONS.LETTERS, key: { 'assignment.participantIds': 1, receivedAt: 1 }, name: 'participant_received_at' },
    { collection: COLLECTIONS.LETTERS, key: { 'assignment.status': 1 }, name: 'assignment_status' },
    { collection: COLLECTIONS.LETTERS, key: { seenByStaff: 1 }, name: 'seen_by_staff' },
    { collection: COLLECTIONS.LETTERS, key: { receivedAt: 1 }, name: 'received_at' },
    {
      collection: COLLECTIONS.SYNC_RUNS,
      key: { startedAt: 1 },
      name: 'started_at_ttl',
      expireAfterSeconds: Math.round(runsTtlDays * 24 * 60 * 60),
    },
  ];
}

/**
 * Creates every index idempotently. Safe to run at each startup and from several processes.
 * A changed TTL is applied with `collMod` instead of failing.
 * @param {import('mongodb').Db} db
 * @param {{ runsTtlDays: number, logger?: import('../../../application/ports/LoggerPort.js').LoggerPort }} options
 * @returns {Promise<string[]>} Names of the ensured indexes.
 */
export async function ensureIndexes(db, { runsTtlDays, logger }) {
  const names = [];
  for (const spec of indexSpecs({ runsTtlDays })) {
    /** @type {import('mongodb').CreateIndexesOptions} */
    const options = { name: spec.name };
    if (spec.expireAfterSeconds !== undefined) options.expireAfterSeconds = spec.expireAfterSeconds;
    try {
      await db.collection(spec.collection).createIndex(spec.key, options);
    } catch (error) {
      const code = /** @type {{ code?: number }} */ (error).code;
      if (code !== INDEX_OPTIONS_CONFLICT || spec.expireAfterSeconds === undefined) throw error;
      await db.command({
        collMod: spec.collection,
        index: { name: spec.name, expireAfterSeconds: spec.expireAfterSeconds },
      });
      logger?.info({ collection: spec.collection, index: spec.name }, 'TTL index updated');
    }
    names.push(spec.name);
  }
  return names;
}
