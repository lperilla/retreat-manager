import { JsonDocumentStore, toPlain } from '../../../infrastructure/persistence/json/JsonDocumentStore.js';
import { createParticipantRecord } from '../domain/ParticipantRecord.js';
import { createRetreat } from '../domain/Retreat.js';
import { sortRecordsByName } from './records.js';

/**
 * JSON-file (or in-memory, with a null path) participant records.
 * @implements {import('../application/ports.js').ParticipantRecordRepositoryPort}
 */
export class JsonParticipantRecordRepository {
  #store;

  /** @param {{ filePath?: string | null }} [options] */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'id' });
  }

  /** @param {string} retreatId */
  findByRetreat(retreatId) {
    return this.#store.read((documents) =>
      sortRecordsByName([...documents.values()].filter((d) => d.retreatId === retreatId).map((d) => createParticipantRecord(d))),
    );
  }

  /** @param {string} id */
  findById(id) {
    return this.#store.read((documents) => {
      const document = documents.get(id);
      return document ? createParticipantRecord(document) : null;
    });
  }

  /** @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record */
  async save(record) {
    const valid = createParticipantRecord(record);
    await this.#store.write((documents) => {
      documents.set(valid.id, toPlain(valid));
    });
  }

  /** @param {string} id */
  delete(id) {
    return this.#store.write((documents) => documents.delete(id));
  }

  /** @param {string} retreatId */
  deleteByRetreat(retreatId) {
    return this.#store.write((documents) => {
      let count = 0;
      for (const [id, document] of documents) {
        if (document.retreatId !== retreatId) continue;
        documents.delete(id);
        count += 1;
      }
      return count;
    });
  }

  /**
   * @param {string} retreatId
   * @param {import('../domain/ParticipantRecord.js').ParticipantRecord[]} records
   */
  async replaceForRetreat(retreatId, records) {
    const valid = records.map((record) => createParticipantRecord({ ...record, retreatId }));
    await this.#store.write((documents) => {
      for (const [id, document] of documents) if (document.retreatId === retreatId) documents.delete(id);
      for (const record of valid) documents.set(record.id, toPlain(record));
    });
  }

  /** JSON stores never held old-style participants (they lived in the separate participants file). */
  async adoptLegacy() {
    return 0;
  }
}

/**
 * @implements {import('../application/ports.js').RetreatRepositoryPort}
 */
export class JsonRetreatRepository {
  #store;

  /** @param {{ filePath?: string | null }} [options] */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'id' });
  }

  findActive() {
    return this.#store.read((documents) => {
      const active = [...documents.values()]
        .filter((d) => d.status === 'active')
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      return active.length > 0 ? createRetreat(active[0]) : null;
    });
  }

  /** @param {string} id */
  findById(id) {
    return this.#store.read((documents) => {
      const document = documents.get(id);
      return document ? createRetreat(document) : null;
    });
  }

  findAll() {
    return this.#store.read((documents) =>
      [...documents.values()]
        .map((d) => createRetreat(d))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  /** @param {import('../domain/Retreat.js').Retreat} retreat */
  async save(retreat) {
    const valid = createRetreat(retreat);
    await this.#store.write((documents) => {
      documents.set(valid.id, toPlain(valid));
    });
  }
}
