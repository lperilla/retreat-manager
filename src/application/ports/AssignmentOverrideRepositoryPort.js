import { definePort } from './definePort.js';

/**
 * Manual assignments keyed by messageId. They always win over heuristics and survive
 * re-syncs and recomputation.
 *
 * @typedef {import('../../domain/entities/AssignmentOverride.js').AssignmentOverride} AssignmentOverride
 *
 * @typedef {Object} AssignmentOverrideRepositoryPort
 * @property {() => Promise<AssignmentOverride[]>} findAll
 * @property {(messageId: string) => Promise<AssignmentOverride | null>} findByMessageId
 * @property {(messageIds: string[]) => Promise<AssignmentOverride[]>} findByMessageIds
 * @property {(override: AssignmentOverride) => Promise<void>} save
 * @property {(messageId: string) => Promise<boolean>} delete
 * @property {() => Promise<number>} deleteAll
 */

export const AssignmentOverrideRepositoryPort = definePort('AssignmentOverrideRepositoryPort', [
  'findAll',
  'findByMessageId',
  'findByMessageIds',
  'save',
  'delete',
  'deleteAll',
]);
