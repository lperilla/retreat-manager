import { createPrintStatus } from '../../../domain/entities/PrintStatus.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

/**
 * @implements {import('../../../application/ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort}
 */
export class JsonPrintStatusRepository {
  #store;

  /**
   * @param {{ filePath?: string | null }} [options]
   */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'participantId' });
  }

  findAll() {
    return this.#store.read((documents) => [...documents.values()].map((document) => createPrintStatus(document)));
  }

  /** @param {string} participantId */
  findByParticipant(participantId) {
    return this.#store.read((documents) => {
      const document = documents.get(participantId);
      return document ? createPrintStatus(document) : null;
    });
  }

  /** @param {import('../../../domain/entities/PrintStatus.js').PrintStatus} status */
  async save(status) {
    await this.saveMany([status]);
  }

  /** @param {import('../../../domain/entities/PrintStatus.js').PrintStatus[]} statuses */
  async saveMany(statuses) {
    const valid = statuses.map((status) => createPrintStatus(status));
    await this.#store.write((documents) => {
      for (const status of valid) documents.set(status.participantId, toPlain(status));
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
