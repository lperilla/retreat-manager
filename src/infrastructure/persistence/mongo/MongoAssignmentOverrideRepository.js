import { COLLECTIONS } from './collections.js';
import { overrideFromDocument, overrideToDocument } from './mappers.js';

/**
 * MongoDB implementation of AssignmentOverrideRepositoryPort
 * (`assignment_overrides`, `_id = messageId`).
 * @implements {import('../../../application/ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort}
 */
export class MongoAssignmentOverrideRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.ASSIGNMENT_OVERRIDES);
  }

  async findAll() {
    const documents = await this.#collection.find({}).toArray();
    return documents.map(overrideFromDocument);
  }

  /** @param {string} messageId */
  async findByMessageId(messageId) {
    const document = await this.#collection.findOne({ _id: messageId });
    return document ? overrideFromDocument(document) : null;
  }

  /** @param {string[]} messageIds */
  async findByMessageIds(messageIds) {
    if (messageIds.length === 0) return [];
    const documents = await this.#collection.find({ _id: { $in: [...new Set(messageIds)] } }).toArray();
    return documents.map(overrideFromDocument);
  }

  /** @param {import('../../../domain/entities/AssignmentOverride.js').AssignmentOverride} override */
  async save(override) {
    const document = overrideToDocument(override);
    await this.#collection.replaceOne({ _id: document._id }, document, { upsert: true });
  }

  /** @param {string} messageId */
  async delete(messageId) {
    const result = await this.#collection.deleteOne({ _id: messageId });
    return result.deletedCount === 1;
  }

  async deleteAll() {
    const result = await this.#collection.deleteMany({});
    return result.deletedCount;
  }
}
