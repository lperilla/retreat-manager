import { definePort } from './definePort.js';

/**
 * @typedef {import('../../domain/entities/AuditEntry.js').AuditEntry} AuditEntry
 *
 * @typedef {Object} AuditLogRepositoryPort
 * @property {(entries: AuditEntry[]) => Promise<void>} appendMany
 * @property {(filter?: { messageId?: string | null, actor?: string | null, limit?: number }) => Promise<AuditEntry[]>} find  Newest first.
 * @property {() => Promise<number>} deleteAll
 */
export const AuditLogRepositoryPort = definePort('AuditLogRepositoryPort', ['appendMany', 'find', 'deleteAll']);
