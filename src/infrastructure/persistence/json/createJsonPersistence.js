import { join } from 'node:path';

import { JsonAssignmentOverrideRepository } from './JsonAssignmentOverrideRepository.js';
import { JsonAuditLogRepository } from './JsonAuditLogRepository.js';
import { JsonLabelStateRepository } from './JsonLabelStateRepository.js';
import { JsonLetterStoreRepository } from './JsonLetterStoreRepository.js';
import { JsonPrintStatusRepository } from './JsonPrintStatusRepository.js';
import { JsonSyncStateRepository } from './JsonSyncStateRepository.js';
import { JsonParticipantRecordRepository, JsonRetreatRepository } from '../../../modules/participants/infrastructure/JsonParticipantStores.js';
import { ParticipantDirectory } from '../../../modules/participants/infrastructure/ParticipantDirectory.js';
import { createRoom, createTable } from '../../../modules/accommodation/domain/accommodation.js';
import { JsonAssignmentRepository, JsonPlaceRepository } from '../../../modules/accommodation/infrastructure/stores.js';

/**
 * @typedef {Object} PersistenceAdapters
 * @property {string} kind  'json' | 'memory' | 'mongo'
 * @property {import('../../../application/ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort} letterStore
 * @property {import('../../../application/ports/SyncStateRepositoryPort.js').SyncStateRepositoryPort} syncStateRepository
 * @property {import('../../../application/ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort} participantRepository
 *           Letters' view of the participants of the active retreat (served by the participants module).
 * @property {import('../../../modules/participants/application/ports.js').ParticipantRecordRepositoryPort} participantRecords
 * @property {import('../../../modules/participants/application/ports.js').RetreatRepositoryPort} retreats
 * @property {import('../../../modules/accommodation/application/ports.js').PlaceRepositoryPort} rooms
 * @property {import('../../../modules/accommodation/application/ports.js').PlaceRepositoryPort} tables
 * @property {import('../../../modules/accommodation/application/ports.js').AssignmentRepositoryPort} roomAssignments
 * @property {import('../../../modules/accommodation/application/ports.js').AssignmentRepositoryPort} tableAssignments
 * @property {import('../../../application/ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort} printStatusRepository
 * @property {import('../../../application/ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort} overrideRepository
 * @property {import('../../../application/ports/LabelStateRepositoryPort.js').LabelStateRepositoryPort} labelStateRepository
 * @property {import('../../../application/ports/AuditLogRepositoryPort.js').AuditLogRepositoryPort} auditLogRepository
 * @property {() => Promise<void>} close
 */

/**
 * JSON-file persistence under `directory`, or pure in-memory persistence when `directory`
 * is null (demo mode and tests).
 * @param {{
 *   directory: string | null,
 *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
 *   runsTtlDays?: number,
 * }} options
 * @returns {PersistenceAdapters}
 */
export function createJsonPersistence({ directory, clock, runsTtlDays = 90 }) {
  const file = (/** @type {string} */ name) => (directory ? join(directory, name) : null);
  // participant_records.json, not participants.json: that name is the hand-written
  // participants list (PARTICIPANTS_FILE) in the same data folder.
  const participantRecords = new JsonParticipantRecordRepository({ filePath: file('participant_records.json') });
  const retreats = new JsonRetreatRepository({ filePath: file('retreats.json') });
  return {
    kind: directory ? 'json' : 'memory',
    letterStore: new JsonLetterStoreRepository({ filePath: file('letters.json') }),
    syncStateRepository: new JsonSyncStateRepository({
      stateFilePath: file('sync_state.json'),
      runsFilePath: file('sync_runs.json'),
      clock,
      runsTtlDays,
    }),
    participantRepository: new ParticipantDirectory({ records: participantRecords, retreats, clock }),
    participantRecords,
    retreats,
    rooms: new JsonPlaceRepository({ filePath: file('rooms.json'), create: createRoom }),
    tables: new JsonPlaceRepository({ filePath: file('tables.json'), create: createTable }),
    roomAssignments: new JsonAssignmentRepository({ filePath: file('room_assignments.json') }),
    tableAssignments: new JsonAssignmentRepository({ filePath: file('table_assignments.json') }),
    printStatusRepository: new JsonPrintStatusRepository({ filePath: file('print_status.json') }),
    overrideRepository: new JsonAssignmentOverrideRepository({ filePath: file('assignment_overrides.json') }),
    labelStateRepository: new JsonLabelStateRepository({ filePath: file('mail_label_states.json') }),
    auditLogRepository: new JsonAuditLogRepository({ filePath: file('audit_log.json') }),
    async close() {},
  };
}
