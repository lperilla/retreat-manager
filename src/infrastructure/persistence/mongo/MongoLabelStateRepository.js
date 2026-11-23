import { createMailLabelState } from '../../../domain/entities/MailLabelState.js';
import { COLLECTIONS } from './collections.js';

/**
 * @param {Record<string, any>} document
 */
function fromDocument(document) {
  const { _id, ...rest } = document;
  return createMailLabelState({ ...rest, messageId: _id });
}

/**
 * MongoDB implementation of LabelStateRepositoryPort (`mail_label_states`, `_id = messageId`).
 * @implements {import('../../../application/ports/LabelStateRepositoryPort.js').LabelStateRepositoryPort}
 */
export class MongoLabelStateRepository {
  /** @type {import('mongodb').Collection<any>} */
  #collection;

  /** @param {import('mongodb').Db} db */
  constructor(db) {
    this.#collection = db.collection(COLLECTIONS.MAIL_LABEL_STATES);
  }

  async findAll() {
    return (await this.#collection.find({}).toArray()).map(fromDocument);
  }

  /** @param {string[]} messageIds */
  async findByMessageIds(messageIds) {
    if (messageIds.length === 0) return [];
    const documents = await this.#collection.find({ _id: { $in: [...new Set(messageIds)] } }).toArray();
    return documents.map(fromDocument);
  }

  /** @param {import('../../../domain/entities/MailLabelState.js').MailLabelState[]} states */
  async saveMany(states) {
    if (states.length === 0) return;
    await this.#collection.bulkWrite(
      states.map((input) => {
        const { messageId, ...fields } = createMailLabelState(input);
        return { replaceOne: { filter: { _id: messageId }, replacement: { ...fields, labels: [...fields.labels] }, upsert: true } };
      }),
      { ordered: false },
    );
  }

  async deleteAll() {
    return (await this.#collection.deleteMany({})).deletedCount;
  }
}
