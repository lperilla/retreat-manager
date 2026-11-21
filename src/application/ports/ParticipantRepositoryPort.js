import { definePort } from './definePort.js';

/**
 * @typedef {import('../../domain/entities/Participant.js').Participant} Participant
 *
 * @typedef {Object} ParticipantRepositoryPort
 * @property {() => Promise<Participant[]>} findAll  Sorted alphabetically (Spanish collation).
 * @property {(id: string) => Promise<Participant | null>} findById
 * @property {(participants: Participant[]) => Promise<void>} replaceAll  Replaces the whole list.
 * @property {() => Promise<number>} deleteAll
 */

export const ParticipantRepositoryPort = definePort('ParticipantRepositoryPort', [
  'findAll',
  'findById',
  'replaceAll',
  'deleteAll',
]);
