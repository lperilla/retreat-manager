import { definePort } from './definePort.js';

/**
 * Print status per participant. Never touched by a sync.
 *
 * @typedef {import('../../domain/entities/PrintStatus.js').PrintStatus} PrintStatus
 *
 * @typedef {Object} PrintStatusRepositoryPort
 * @property {() => Promise<PrintStatus[]>} findAll
 * @property {(participantId: string) => Promise<PrintStatus | null>} findByParticipant
 * @property {(status: PrintStatus) => Promise<void>} save
 * @property {(statuses: PrintStatus[]) => Promise<void>} saveMany
 * @property {() => Promise<number>} deleteAll
 */

export const PrintStatusRepositoryPort = definePort('PrintStatusRepositoryPort', [
  'findAll',
  'findByParticipant',
  'save',
  'saveMany',
  'deleteAll',
]);
