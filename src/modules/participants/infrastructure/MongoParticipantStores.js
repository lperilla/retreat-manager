import { createParticipantRecord } from '../domain/ParticipantRecord.js';
import { createRetreat } from '../domain/Retreat.js';
import { legacyToRecord, sortRecordsByName } from './records.js';

/** Collections of the participants module. `participants` is shared with older versions. */
export const PARTICIPANT_COLLECTIONS = Object.freeze({ PARTICIPANTS: 'participants', RETREATS: 'retreats' });

/**
 * @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record
 */
function toDocument(record) {
  const { id, ...rest } = createParticipantRecord(record);
  return {
    _id: id,
    ...rest,
    aliases: [...rest.aliases],
    emergencyContacts: rest.emergencyContacts.map((c) => ({ ...c })),
    dietary: rest.dietary.map((d) => ({ ...d })),
    accessibilityNeeds: rest.accessibilityNeeds.map((n) => ({ ...n })),
  };
}

/** @param {Record<string, any>} document */
function fromDocument(document) {
  const { _id, ...rest } = document;
  return createParticipantRecord({ ...rest, id: _id });
}

/**
 * MongoDB participant records (`participants`, `_id = participant id`, field `retreatId`).
 * @implements {import('../application/ports.js').ParticipantRecordRepositoryPort}
 */
export class MongoParticipantRecordRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(PARTICIPANT_COLLECTIONS.PARTICIPANTS);
  }

  /** @param {string} retreatId */
  async findByRetreat(retreatId) {
    const documents = await this.#collection.find({ retreatId }).toArray();
    return sortRecordsByName(documents.map(fromDocument));
  }

  /** @param {string} id */
  async findById(id) {
    const document = await this.#collection.findOne({ _id: id, retreatId: { $exists: true } });
    return document ? fromDocument(document) : null;
  }

  /** @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record */
  async save(record) {
    const document = toDocument(record);
    await this.#collection.replaceOne({ _id: document._id }, document, { upsert: true });
  }

  /** @param {string} id */
  async delete(id) {
    const result = await this.#collection.deleteOne({ _id: id });
    return result.deletedCount > 0;
  }

  /** @param {string} retreatId */
  async deleteByRetreat(retreatId) {
    const result = await this.#collection.deleteMany({ retreatId });
    return result.deletedCount;
  }

  /**
   * @param {string} retreatId
   * @param {import('../domain/ParticipantRecord.js').ParticipantRecord[]} records
   */
  async replaceForRetreat(retreatId, records) {
    const documents = records.map((record) => toDocument({ ...record, retreatId }));
    if (documents.length > 0) {
      await this.#collection.bulkWrite(
        documents.map((document) => ({ replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } })),
        { ordered: false },
      );
    }
    await this.#collection.deleteMany({ retreatId, _id: { $nin: documents.map((d) => d._id) } });
  }

  /**
   * Documents written by older versions only have `displayName` and `aliases` (no retreat):
   * they become records of the active retreat, keeping their id (letters, print status and
   * manual assignments point to it).
   * @param {string} retreatId
   * @param {Date} now
   */
  async adoptLegacy(retreatId, now) {
    const legacy = await this.#collection.find({ retreatId: { $exists: false } }).toArray();
    for (const document of legacy) {
      const record = legacyToRecord({ id: document._id, displayName: document.displayName, aliases: document.aliases ?? [] }, { retreatId, now });
      await this.#collection.replaceOne({ _id: document._id, retreatId: { $exists: false } }, toDocument(record));
    }
    return legacy.length;
  }
}

/** @param {Record<string, any>} document */
function retreatFromDocument(document) {
  const { _id, ...rest } = document;
  return createRetreat({ ...rest, id: _id });
}

/**
 * @implements {import('../application/ports.js').RetreatRepositoryPort}
 */
export class MongoRetreatRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(PARTICIPANT_COLLECTIONS.RETREATS);
  }

  async findActive() {
    const [document] = await this.#collection.find({ status: 'active' }).sort({ createdAt: 1 }).limit(1).toArray();
    return document ? retreatFromDocument(document) : null;
  }

  /** @param {string} id */
  async findById(id) {
    const document = await this.#collection.findOne({ _id: id });
    return document ? retreatFromDocument(document) : null;
  }

  async findAll() {
    const documents = await this.#collection.find({}).sort({ createdAt: -1 }).toArray();
    return documents.map(retreatFromDocument);
  }

  /** @param {import('../domain/Retreat.js').Retreat} retreat */
  async save(retreat) {
    const { id, ...rest } = createRetreat(retreat);
    await this.#collection.replaceOne({ _id: id }, { _id: id, ...rest, summary: rest.summary ? { ...rest.summary } : null }, { upsert: true });
  }
}
