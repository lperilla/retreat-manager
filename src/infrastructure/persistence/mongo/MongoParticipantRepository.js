import { assertUniqueParticipantIds, createParticipant, sortParticipantsByName } from '../../../domain/entities/Participant.js';
import { COLLECTIONS } from './collections.js';
import { participantFromDocument, participantToDocument } from './mappers.js';

/**
 * MongoDB implementation of ParticipantRepositoryPort (`participants`, `_id = slug`).
 * @implements {import('../../../application/ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort}
 */
export class MongoParticipantRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /**
   * @param {import('mongodb').Db} db
   */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.PARTICIPANTS);
  }

  async findAll() {
    const documents = await this.#collection.find({}).toArray();
    return sortParticipantsByName(documents.map(participantFromDocument));
  }

  /** @param {string} id */
  async findById(id) {
    const document = await this.#collection.findOne({ _id: id });
    return document ? participantFromDocument(document) : null;
  }

  /**
   * Replaces the whole list: upserts the given participants and removes the rest.
   * @param {import('../../../domain/entities/Participant.js').Participant[]} participants
   */
  async replaceAll(participants) {
    const valid = assertUniqueParticipantIds(participants.map((participant) => createParticipant(participant)));
    if (valid.length > 0) {
      await this.#collection.bulkWrite(
        valid.map((participant) => {
          const document = participantToDocument(participant);
          return { replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true } };
        }),
        { ordered: false },
      );
    }
    await this.#collection.deleteMany({ _id: { $nin: valid.map((participant) => participant.id) } });
  }

  async deleteAll() {
    const result = await this.#collection.deleteMany({});
    return result.deletedCount;
  }
}
