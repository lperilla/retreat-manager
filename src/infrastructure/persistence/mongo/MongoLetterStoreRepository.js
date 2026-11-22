import { AssignmentStatus } from '../../../domain/constants.js';
import { COLLECTIONS } from './collections.js';
import {
  assignmentToDocument,
  flagsToDocument,
  letterContentFields,
  letterFromDocument,
  letterNoveltyFields,
} from './mappers.js';

const CHRONOLOGICAL = /** @type {const} */ ({ receivedAt: 1, _id: 1 });

/**
 * MongoDB implementation of LetterStoreRepositoryPort (`letters`, `_id = messageId`).
 * @implements {import('../../../application/ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort}
 */
export class MongoLetterStoreRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.LETTERS);
  }

  /**
   * Upserts by messageId. Novelty fields go through `$setOnInsert`, so an existing letter
   * keeps `firstSeenAt`, `syncRunId` and `seenByStaff` even under concurrent updates.
   * @param {import('../../../domain/entities/Letter.js').Letter[]} letters
   */
  async upsertMany(letters) {
    if (letters.length === 0) return { inserted: 0, updated: 0 };
    const operations = letters.map((letter) => ({
      updateOne: {
        filter: { _id: letter.messageId },
        update: { $set: letterContentFields(letter), $setOnInsert: letterNoveltyFields(letter) },
        upsert: true,
      },
    }));
    const result = await this.#collection.bulkWrite(operations, { ordered: false });
    return { inserted: result.upsertedCount, updated: result.matchedCount };
  }

  /** @param {string} retreatId */
  async assignRetreat(retreatId) {
    const result = await this.#collection.updateMany({ $or: [{ retreatId: { $exists: false } }, { retreatId: null }] }, { $set: { retreatId } });
    return result.modifiedCount;
  }

  /**
   * @param {string[]} messageIds
   * @param {Date} deletedAt
   */
  async softDeleteMany(messageIds, deletedAt) {
    if (messageIds.length === 0) return 0;
    const result = await this.#collection.updateMany(
      { _id: { $in: [...new Set(messageIds)] }, deletedAt: null },
      { $set: { deletedAt } },
    );
    return result.modifiedCount;
  }

  /** @param {import('../../../application/ports/LetterStoreRepositoryPort.js').AssignmentUpdate[]} updates */
  async updateAssignments(updates) {
    if (updates.length === 0) return 0;
    const operations = updates.map((update) => ({
      updateOne: {
        filter: { _id: update.messageId },
        update: { $set: { assignment: assignmentToDocument(update.assignment), flags: flagsToDocument(update.flags ?? []) } },
      },
    }));
    const result = await this.#collection.bulkWrite(operations, { ordered: false });
    return result.matchedCount;
  }

  /** @param {{ includeDeleted?: boolean }} [options] */
  async findAll({ includeDeleted = false } = {}) {
    const documents = await this.#collection
      .find(includeDeleted ? {} : { deletedAt: null })
      .sort(CHRONOLOGICAL)
      .toArray();
    return documents.map(letterFromDocument);
  }

  /** @param {string} messageId */
  async findById(messageId) {
    const document = await this.#collection.findOne({ _id: messageId });
    return document ? letterFromDocument(document) : null;
  }

  /** @param {string} participantId */
  async findByParticipant(participantId) {
    const documents = await this.#collection
      .find({
        'assignment.participantIds': participantId,
        'assignment.status': AssignmentStatus.ASSIGNED,
        deletedAt: null,
      })
      .sort(CHRONOLOGICAL)
      .toArray();
    return documents.map(letterFromDocument);
  }

  async findNeedingReview() {
    const documents = await this.#collection
      .find({ 'assignment.status': AssignmentStatus.NEEDS_REVIEW, deletedAt: null })
      .sort(CHRONOLOGICAL)
      .toArray();
    return documents.map(letterFromDocument);
  }

  /** @param {{ participantId?: string | null, messageIds?: string[] | null }} [filter] */
  async markSeen({ participantId = null, messageIds = null } = {}) {
    /** @type {Record<string, unknown>} */
    const query = { deletedAt: null, seenByStaff: false };
    if (messageIds) query._id = { $in: [...new Set(messageIds)] };
    if (participantId) {
      query['assignment.participantIds'] = participantId;
      query['assignment.status'] = AssignmentStatus.ASSIGNED;
    }
    const result = await this.#collection.updateMany(query, { $set: { seenByStaff: true } });
    return result.modifiedCount;
  }

  async getKnownMessageIds() {
    const documents = await this.#collection
      .find({}, { projection: { _id: 1, contentHash: 1, deletedAt: 1 } })
      .toArray();
    return documents.map((document) => ({
      messageId: document._id,
      contentHash: document.contentHash ?? '',
      deletedAt: document.deletedAt ?? null,
    }));
  }

  async deleteAll() {
    const result = await this.#collection.deleteMany({});
    return result.deletedCount;
  }
}
