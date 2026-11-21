import {
  assertUniqueParticipantIds,
  createParticipant,
  sortParticipantsByName,
} from '../../../domain/entities/Participant.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

/**
 * @implements {import('../../../application/ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort}
 */
export class JsonParticipantRepository {
  #store;

  /**
   * @param {{ filePath?: string | null }} [options]
   */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'id' });
  }

  findAll() {
    return this.#store.read((documents) =>
      sortParticipantsByName([...documents.values()].map((document) => createParticipant(document))),
    );
  }

  /** @param {string} id */
  findById(id) {
    return this.#store.read((documents) => {
      const document = documents.get(id);
      return document ? createParticipant(document) : null;
    });
  }

  /** @param {import('../../../domain/entities/Participant.js').Participant[]} participants */
  async replaceAll(participants) {
    const valid = assertUniqueParticipantIds(participants.map((participant) => createParticipant(participant)));
    await this.#store.write((documents) => {
      documents.clear();
      for (const participant of valid) documents.set(participant.id, toPlain(participant));
    });
  }

  deleteAll() {
    return this.#store.write((documents) => {
      const count = documents.size;
      documents.clear();
      return count;
    });
  }
}
