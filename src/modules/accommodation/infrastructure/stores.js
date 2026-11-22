import { JsonDocumentStore, toPlain } from '../../../infrastructure/persistence/json/JsonDocumentStore.js';
import { createAssignment } from '../domain/accommodation.js';

/** Collections of the accommodation module. */
export const ACCOMMODATION_COLLECTIONS = Object.freeze({
  ROOMS: 'rooms',
  TABLES: 'tables',
  ROOM_ASSIGNMENTS: 'room_assignments',
  TABLE_ASSIGNMENTS: 'table_assignments',
});

/**
 * Natural order: "Habitación 2" before "Habitación 10".
 * @template {{ name: string }} T
 * @param {T[]} places
 * @returns {T[]}
 */
function byName(places) {
  return places.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }));
}

/**
 * Rooms or tables in a JSON file (or in memory).
 * @implements {import('../application/ports.js').PlaceRepositoryPort}
 */
export class JsonPlaceRepository {
  #store;
  #create;

  /** @param {{ filePath?: string | null, create: (props: any) => any }} options */
  constructor({ filePath = null, create }) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'id' });
    this.#create = create;
  }

  /** @param {string} retreatId */
  findByRetreat(retreatId) {
    return this.#store.read((docs) => byName([...docs.values()].filter((d) => d.retreatId === retreatId).map((d) => this.#create(d))));
  }

  /** @param {string} id */
  findById(id) {
    return this.#store.read((docs) => (docs.has(id) ? this.#create(docs.get(id)) : null));
  }

  /** @param {any} place */
  async save(place) {
    const valid = this.#create(place);
    await this.#store.write((docs) => {
      docs.set(valid.id, toPlain(valid));
    });
  }

  /** @param {string} id */
  delete(id) {
    return this.#store.write((docs) => docs.delete(id));
  }

  /** @param {string} retreatId */
  deleteByRetreat(retreatId) {
    return this.#store.write((docs) => {
      let count = 0;
      for (const [id, doc] of docs) if (doc.retreatId === retreatId && docs.delete(id)) count += 1;
      return count;
    });
  }
}

/**
 * Room or table assignments in a JSON file (one per participant).
 * @implements {import('../application/ports.js').AssignmentRepositoryPort}
 */
export class JsonAssignmentRepository {
  #store;

  /** @param {{ filePath?: string | null }} [options] */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'participantId' });
  }

  /** @param {string} retreatId */
  findByRetreat(retreatId) {
    return this.#store.read((docs) => [...docs.values()].filter((d) => d.retreatId === retreatId).map((d) => createAssignment(d)));
  }

  /** @param {string} participantId */
  findByParticipant(participantId) {
    return this.#store.read((docs) => (docs.has(participantId) ? createAssignment(docs.get(participantId)) : null));
  }

  /** @param {import('../domain/accommodation.js').Assignment} assignment */
  async save(assignment) {
    const valid = createAssignment(assignment);
    await this.#store.write((docs) => {
      docs.set(valid.participantId, toPlain(valid));
    });
  }

  /** @param {string} participantId */
  deleteByParticipant(participantId) {
    return this.#store.write((docs) => docs.delete(participantId));
  }

  /** @param {string} retreatId */
  deleteByRetreat(retreatId) {
    return this.#store.write((docs) => {
      let count = 0;
      for (const [id, doc] of docs) if (doc.retreatId === retreatId && docs.delete(id)) count += 1;
      return count;
    });
  }
}

/**
 * Rooms or tables in MongoDB (`_id = id`).
 * @implements {import('../application/ports.js').PlaceRepositoryPort}
 */
export class MongoPlaceRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;
  #create;

  /**
   * @param {import('mongodb').Db} db
   * @param {{ collection: string, create: (props: any) => any }} options
   */
  constructor(db, { collection, create }) {
    this.#collection = db.collection(collection);
    this.#create = create;
  }

  /** @param {Record<string, any>} doc */
  #fromDocument(doc) {
    const { _id, ...rest } = doc;
    return this.#create({ ...rest, id: _id });
  }

  /** @param {string} retreatId */
  async findByRetreat(retreatId) {
    return byName((await this.#collection.find({ retreatId }).toArray()).map((d) => this.#fromDocument(d)));
  }

  /** @param {string} id */
  async findById(id) {
    const doc = await this.#collection.findOne({ _id: id });
    return doc ? this.#fromDocument(doc) : null;
  }

  /** @param {any} place */
  async save(place) {
    const { id, ...rest } = this.#create(place);
    await this.#collection.replaceOne({ _id: id }, { _id: id, ...rest }, { upsert: true });
  }

  /** @param {string} id */
  async delete(id) {
    return (await this.#collection.deleteOne({ _id: id })).deletedCount > 0;
  }

  /** @param {string} retreatId */
  async deleteByRetreat(retreatId) {
    return (await this.#collection.deleteMany({ retreatId })).deletedCount;
  }
}

/**
 * Room or table assignments in MongoDB (`_id = participantId`).
 * @implements {import('../application/ports.js').AssignmentRepositoryPort}
 */
export class MongoAssignmentRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /**
   * @param {import('mongodb').Db} db
   * @param {{ collection: string }} options
   */
  constructor(db, { collection }) {
    this.#collection = db.collection(collection);
  }

  /** @param {Record<string, any>} doc */
  static #fromDocument(doc) {
    const { _id, ...rest } = doc;
    return createAssignment({ ...rest, participantId: _id });
  }

  /** @param {string} retreatId */
  async findByRetreat(retreatId) {
    return (await this.#collection.find({ retreatId }).toArray()).map((d) => MongoAssignmentRepository.#fromDocument(d));
  }

  /** @param {string} participantId */
  async findByParticipant(participantId) {
    const doc = await this.#collection.findOne({ _id: participantId });
    return doc ? MongoAssignmentRepository.#fromDocument(doc) : null;
  }

  /** @param {import('../domain/accommodation.js').Assignment} assignment */
  async save(assignment) {
    const { participantId, ...rest } = createAssignment(assignment);
    await this.#collection.replaceOne({ _id: participantId }, { _id: participantId, ...rest }, { upsert: true });
  }

  /** @param {string} participantId */
  async deleteByParticipant(participantId) {
    return (await this.#collection.deleteOne({ _id: participantId })).deletedCount > 0;
  }

  /** @param {string} retreatId */
  async deleteByRetreat(retreatId) {
    return (await this.#collection.deleteMany({ retreatId })).deletedCount;
  }
}
