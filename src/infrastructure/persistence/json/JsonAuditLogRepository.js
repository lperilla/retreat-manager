import { createAuditEntry } from '../../../domain/entities/AuditEntry.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

/**
 * Append-only audit trail.
 * @implements {import('../../../application/ports/AuditLogRepositoryPort.js').AuditLogRepositoryPort}
 */
export class JsonAuditLogRepository {
  #store;

  /** @param {{ filePath?: string | null }} [options] */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'id' });
  }

  /** @param {import('../../../domain/entities/AuditEntry.js').AuditEntry[]} entries */
  async appendMany(entries) {
    const valid = entries.map((entry) => createAuditEntry(entry));
    if (valid.length === 0) return;
    await this.#store.write((documents) => {
      for (const entry of valid) documents.set(entry.id, toPlain(entry));
    });
  }

  /** @param {{ messageId?: string | null, actor?: string | null, limit?: number }} [filter] */
  find({ messageId = null, actor = null, limit = 100 } = {}) {
    return this.#store.read((documents) =>
      [...documents.values()]
        .map((document) => createAuditEntry(document))
        .filter((entry) => (!messageId || entry.messageId === messageId) && (!actor || entry.actor === actor))
        .sort((a, b) => b.at.getTime() - a.at.getTime())
        .slice(0, Math.max(1, Math.min(1000, limit))),
    );
  }

  deleteAll() {
    return this.#store.write((documents) => {
      const count = documents.size;
      documents.clear();
      return count;
    });
  }
}
