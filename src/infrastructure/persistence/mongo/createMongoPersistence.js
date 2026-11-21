import { connectMongo } from './MongoConnection.js';
import { ensureIndexes } from './indexes.js';
import { MongoAssignmentOverrideRepository } from './MongoAssignmentOverrideRepository.js';
import { MongoLetterStoreRepository } from './MongoLetterStoreRepository.js';
import { MongoParticipantRepository } from './MongoParticipantRepository.js';
import { MongoPrintStatusRepository } from './MongoPrintStatusRepository.js';
import { MongoSyncStateRepository } from './MongoSyncStateRepository.js';

/**
 * Builds the Mongo repositories over an existing database handle (indexes must exist).
 * @param {import('mongodb').Db} db
 * @param {{ clock: import('../../../application/ports/ClockPort.js').ClockPort }} options
 */
export function buildMongoRepositories(db, { clock }) {
  return {
    letterStore: new MongoLetterStoreRepository(db),
    syncStateRepository: new MongoSyncStateRepository(db, { clock }),
    participantRepository: new MongoParticipantRepository(db),
    printStatusRepository: new MongoPrintStatusRepository(db),
    overrideRepository: new MongoAssignmentOverrideRepository(db),
  };
}

/**
 * Connects, creates the indexes idempotently and returns the persistence adapters.
 * @param {{
 *   uri: string,
 *   dbName: string,
 *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
 *   logger: import('../../../application/ports/LoggerPort.js').LoggerPort,
 *   runsTtlDays?: number,
 * }} options
 * @returns {Promise<import('../json/createJsonPersistence.js').PersistenceAdapters & { db: import('mongodb').Db }>}
 */
export async function createMongoPersistence({ uri, dbName, clock, logger, runsTtlDays = 90 }) {
  const { client, db } = await connectMongo({ uri, dbName, logger });
  try {
    await ensureIndexes(db, { runsTtlDays, logger });
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  }
  return {
    kind: 'mongo',
    db,
    ...buildMongoRepositories(db, { clock }),
    async close() {
      await client.close();
    },
  };
}
