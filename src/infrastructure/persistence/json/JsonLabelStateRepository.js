import { createMailLabelState } from '../../../domain/entities/MailLabelState.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

/**
 * @implements {import('../../../application/ports/LabelStateRepositoryPort.js').LabelStateRepositoryPort}
 */
export class JsonLabelStateRepository {
  #store;

  /** @param {{ filePath?: string | null }} [options] */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'messageId' });
  }

  findAll() {
    return this.#store.read((documents) => [...documents.values()].map((document) => createMailLabelState(document)));
  }

  /** @param {string[]} messageIds */
  findByMessageIds(messageIds) {
    return this.#store.read((documents) =>
      [...new Set(messageIds)]
        .map((id) => documents.get(id))
        .filter((document) => document !== undefined)
        .map((document) => createMailLabelState(document)),
    );
  }

  /** @param {import('../../../domain/entities/MailLabelState.js').MailLabelState[]} states */
  async saveMany(states) {
    const valid = states.map((state) => createMailLabelState(state));
    await this.#store.write((documents) => {
      for (const state of valid) documents.set(state.messageId, toPlain(state));
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
