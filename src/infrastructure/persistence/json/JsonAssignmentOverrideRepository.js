import { createAssignmentOverride } from '../../../domain/entities/AssignmentOverride.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

/**
 * @implements {import('../../../application/ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort}
 */
export class JsonAssignmentOverrideRepository {
  #store;

  /**
   * @param {{ filePath?: string | null }} [options]
   */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'messageId' });
  }

  findAll() {
    return this.#store.read((documents) => [...documents.values()].map((document) => createAssignmentOverride(document)));
  }

  /** @param {string} messageId */
  findByMessageId(messageId) {
    return this.#store.read((documents) => {
      const document = documents.get(messageId);
      return document ? createAssignmentOverride(document) : null;
    });
  }

  /** @param {string[]} messageIds */
  findByMessageIds(messageIds) {
    return this.#store.read((documents) =>
      [...new Set(messageIds)]
        .map((messageId) => documents.get(messageId))
        .filter((document) => document !== undefined)
        .map((document) => createAssignmentOverride(document)),
    );
  }

  /** @param {import('../../../domain/entities/AssignmentOverride.js').AssignmentOverride} override */
  async save(override) {
    const valid = createAssignmentOverride(override);
    await this.#store.write((documents) => {
      documents.set(valid.messageId, toPlain(valid));
    });
  }

  /** @param {string} messageId */
  delete(messageId) {
    return this.#store.write((documents) => documents.delete(messageId));
  }

  deleteAll() {
    return this.#store.write((documents) => {
      const count = documents.size;
      documents.clear();
      return count;
    });
  }
}
