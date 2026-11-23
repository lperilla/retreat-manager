import { createAuditEntry } from '../../../domain/entities/AuditEntry.js';
import { COLLECTIONS } from './collections.js';

/**
 * MongoDB implementation of AuditLogRepositoryPort (`audit_log`, `_id = entry id`).
 * @implements {import('../../../application/ports/AuditLogRepositoryPort.js').AuditLogRepositoryPort}
 */
export class MongoAuditLogRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.AUDIT_LOG);
  }

  /** @param {import('../../../domain/entities/AuditEntry.js').AuditEntry[]} entries */
  async appendMany(entries) {
    if (entries.length === 0) return;
    const documents = entries.map((input) => {
      const { id, ...fields } = createAuditEntry(input);
      return { _id: id, ...fields, participantIds: [...fields.participantIds], details: { ...fields.details } };
    });
    await this.#collection.insertMany(documents, { ordered: false });
  }

  /** @param {{ messageId?: string | null, actor?: string | null, limit?: number }} [filter] */
  async find({ messageId = null, actor = null, limit = 100 } = {}) {
    const query = { ...(messageId ? { messageId } : {}), ...(actor ? { actor } : {}) };
    const documents = await this.#collection
      .find(query)
      .sort({ at: -1 })
      .limit(Math.max(1, Math.min(1000, limit)))
      .toArray();
    return documents.map(({ _id, ...rest }) => createAuditEntry({ ...rest, id: String(_id) }));
  }

  async deleteAll() {
    return (await this.#collection.deleteMany({})).deletedCount;
  }
}
