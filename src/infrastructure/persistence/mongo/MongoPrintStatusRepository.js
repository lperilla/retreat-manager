import { COLLECTIONS } from './collections.js';
import { printStatusFromDocument, printStatusToDocument } from './mappers.js';

/**
 * MongoDB implementation of PrintStatusRepositoryPort (`print_status`, `_id = participantId`).
 * @implements {import('../../../application/ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort}
 */
export class MongoPrintStatusRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PRINT_STATUS);
  }

  async findAll() {
    const documents = await this.#collection.find({}).toArray();
    return documents.map(printStatusFromDocument);
  }

  /** @param {string} participantId */
  async findByParticipant(participantId) {
    const document = await this.#collection.findOne({ _id: participantId });
    return document ? printStatusFromDocument(document) : null;
  }

  /** @param {import('../../../domain/entities/PrintStatus.js').PrintStatus} status */
  async save(status) {
    await this.saveMany([status]);
  }

  /** @param {import('../../../domain/entities/PrintStatus.js').PrintStatus[]} statuses */
  async saveMany(statuses) {
    if (statuses.length === 0) return;
    await this.#collection.bulkWrite(
      statuses.map((status) => {
        const document = printStatusToDocument(status);
        return { replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } };
      }),
      { ordered: false },
    );
  }

  async deleteAll() {
    const result = await this.#collection.deleteMany({});
    return result.deletedCount;
  }
}
