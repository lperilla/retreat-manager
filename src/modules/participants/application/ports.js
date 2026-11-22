import { definePort } from '../../../application/ports/definePort.js';

/**
 * Ports of the participants module.
 *
 * @typedef {import('../domain/ParticipantRecord.js').ParticipantRecord} ParticipantRecord
 * @typedef {import('../domain/Retreat.js').Retreat} Retreat
 *
 * @typedef {Object} ParticipantRecordRepositoryPort
 * @property {(retreatId: string) => Promise<ParticipantRecord[]>} findByRetreat  Sorted by name.
 * @property {(id: string) => Promise<ParticipantRecord | null>} findById
 * @property {(record: ParticipantRecord) => Promise<void>} save  Insert or replace.
 * @property {(id: string) => Promise<boolean>} delete
 * @property {(retreatId: string) => Promise<number>} deleteByRetreat
 * @property {(retreatId: string, records: ParticipantRecord[]) => Promise<void>} replaceForRetreat
 *           Seeding (demo mode, tests, import): upserts the records and removes the rest of the retreat.
 * @property {(retreatId: string, now: Date) => Promise<number>} adoptLegacy
 *           Converts participants stored by older versions (name only, no retreat) into records.
 *
 * @typedef {Object} RetreatRepositoryPort
 * @property {() => Promise<Retreat | null>} findActive
 * @property {(id: string) => Promise<Retreat | null>} findById
 * @property {() => Promise<Retreat[]>} findAll  Newest first.
 * @property {(retreat: Retreat) => Promise<void>} save
 */

export const ParticipantRecordRepositoryPort = definePort('ParticipantRecordRepositoryPort', [
  'findByRetreat',
  'findById',
  'save',
  'delete',
  'deleteByRetreat',
  'replaceForRetreat',
  'adoptLegacy',
]);

export const RetreatRepositoryPort = definePort('RetreatRepositoryPort', ['findActive', 'findById', 'findAll', 'save']);
