import { connectMongo } from './MongoConnection.js';
import { ensureIndexes } from './indexes.js';
import { MongoAssignmentOverrideRepository } from './MongoAssignmentOverrideRepository.js';
import { MongoAuditLogRepository } from './MongoAuditLogRepository.js';
import { MongoLabelStateRepository } from './MongoLabelStateRepository.js';
import { MongoLetterStoreRepository } from './MongoLetterStoreRepository.js';
import { MongoPrintStatusRepository } from './MongoPrintStatusRepository.js';
import { MongoSyncStateRepository } from './MongoSyncStateRepository.js';
import { MongoParticipantRecordRepository, MongoRetreatRepository } from '../../../modules/participants/infrastructure/MongoParticipantStores.js';
import { ParticipantDirectory } from '../../../modules/participants/infrastructure/ParticipantDirectory.js';
import { createRoom, createTable } from '../../../modules/accommodation/domain/accommodation.js';
import { ACCOMMODATION_COLLECTIONS as AC, MongoAssignmentRepository, MongoPlaceRepository } from '../../../modules/accommodation/infrastructure/stores.js';

/**
 * Builds the Mongo repositories over an existing database handle (indexes must exist).
 * @param {import('mongodb').Db} db
 * @param {{ clock: import('../../../application/ports/ClockPort.js').ClockPort }} options
 */
export function buildMongoRepositories(db, { clock }) {
  const participantRecords = new MongoParticipantRecordRepository(db);
  const retreats = new MongoRetreatRepository(db);
  return {
    letterStore: new MongoLetterStoreRepository(db),
    syncStateRepository: new MongoSyncStateRepository(db, { clock }),
    participantRepository: new ParticipantDirectory({ records: participantRecords, retreats, clock }),
    participantRecords,
    retreats,
    rooms: new MongoPlaceRepository(db, { collection: AC.ROOMS, create: createRoom }),
    tables: new MongoPlaceRepository(db, { collection: AC.TABLES, create: createTable }),
    roomAssignments: new MongoAssignmentRepository(db, { collection: AC.ROOM_ASSIGNMENTS }),
    tableAssignments: new MongoAssignmentRepository(db, { collection: AC.TABLE_ASSIGNMENTS }),
    printStatusRepository: new MongoPrintStatusRepository(db),
    overrideRepository: new MongoAssignmentOverrideRepository(db),
    labelStateRepository: new MongoLabelStateRepository(db),
    auditLogRepository: new MongoAuditLogRepository(db),
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
