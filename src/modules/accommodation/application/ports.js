import { definePort } from '../../../application/ports/definePort.js';

/**
 * Ports of the accommodation module (rooms and tables).
 *
 * @typedef {Object} PlaceRepositoryPort  Rooms or tables of a retreat.
 * @property {(retreatId: string) => Promise<any[]>} findByRetreat  Sorted by name (natural order: 2 < 10).
 * @property {(id: string) => Promise<any | null>} findById
 * @property {(place: any) => Promise<void>} save
 * @property {(id: string) => Promise<boolean>} delete
 * @property {(retreatId: string) => Promise<number>} deleteByRetreat
 *
 * @typedef {Object} AssignmentRepositoryPort  One assignment per participant (room or table).
 * @property {(retreatId: string) => Promise<import('../domain/accommodation.js').Assignment[]>} findByRetreat
 * @property {(participantId: string) => Promise<import('../domain/accommodation.js').Assignment | null>} findByParticipant
 * @property {(assignment: import('../domain/accommodation.js').Assignment) => Promise<void>} save  Replaces the participant's assignment.
 * @property {(participantId: string) => Promise<boolean>} deleteByParticipant
 * @property {(retreatId: string) => Promise<number>} deleteByRetreat
 *
 * @typedef {Object} ParticipantLookupPort  Read-only view of the participants module.
 * @property {(retreatId: string) => Promise<ReadonlyArray<import('../../participants/domain/ParticipantRecord.js').ParticipantRecord>>} findByRetreat
 */

export const PlaceRepositoryPort = definePort('PlaceRepositoryPort', ['findByRetreat', 'findById', 'save', 'delete', 'deleteByRetreat']);

export const AssignmentRepositoryPort = definePort('AssignmentRepositoryPort', [
  'findByRetreat',
  'findByParticipant',
  'save',
  'deleteByParticipant',
  'deleteByRetreat',
]);
