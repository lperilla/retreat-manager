import { AssignmentStatus } from '../../../domain/constants.js';
import { createAssignment } from '../../../domain/entities/Assignment.js';
import { createFlag, createLetter, isAssignedTo, isLetterActive } from '../../../domain/entities/Letter.js';
import { sortChronologically } from '../../../domain/services/grouping.js';
import { JsonDocumentStore, toPlain } from './JsonDocumentStore.js';

/**
 * JSON / in-memory implementation of LetterStoreRepositoryPort.
 * @implements {import('../../../application/ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort}
 */
export class JsonLetterStoreRepository {
  #store;

  /**
   * @param {{ filePath?: string | null }} [options]
   */
  constructor({ filePath = null } = {}) {
    this.#store = new JsonDocumentStore({ filePath, idField: 'messageId' });
  }

  /**
   * @param {ReadonlyMap<string, Record<string, any>>} documents
   * @returns {import('../../../domain/entities/Letter.js').Letter[]}
   */
  #all(documents) {
    return [...documents.values()].map((document) => createLetter(document));
  }

  /** @param {import('../../../domain/entities/Letter.js').Letter[]} letters */
  upsertMany(letters) {
    return this.#store.write((documents) => {
      let inserted = 0;
      let updated = 0;
      for (const letter of letters) {
        const document = toPlain(createLetter(letter));
        const existing = documents.get(document.messageId);
        if (existing) {
          documents.set(document.messageId, {
            ...document,
            firstSeenAt: existing.firstSeenAt ?? document.firstSeenAt,
            syncRunId: existing.syncRunId ?? document.syncRunId,
            seenByStaff: existing.seenByStaff === true,
          });
          updated += 1;
        } else {
          documents.set(document.messageId, document);
          inserted += 1;
        }
      }
      return { inserted, updated };
    });
  }

  /**
   * @param {string[]} messageIds
   * @param {Date} deletedAt
   */
  softDeleteMany(messageIds, deletedAt) {
    return this.#store.write((documents) => {
      let count = 0;
      for (const messageId of new Set(messageIds)) {
        const existing = documents.get(messageId);
        if (!existing || existing.deletedAt) continue;
        documents.set(messageId, { ...existing, deletedAt: deletedAt.toISOString() });
        count += 1;
      }
      return count;
    });
  }

  /** @param {import('../../../application/ports/LetterStoreRepositoryPort.js').AssignmentUpdate[]} updates */
  updateAssignments(updates) {
    return this.#store.write((documents) => {
      let count = 0;
      for (const update of updates) {
        const existing = documents.get(update.messageId);
        if (!existing) continue;
        documents.set(update.messageId, {
          ...existing,
          assignment: toPlain(createAssignment(update.assignment)),
          flags: toPlain((update.flags ?? existing.flags ?? []).map(createFlag)),
        });
        count += 1;
      }
      return count;
    });
  }

  /** @param {{ includeDeleted?: boolean }} [options] */
  findAll({ includeDeleted = false } = {}) {
    return this.#store.read((documents) => {
      const letters = this.#all(documents);
      return sortChronologically(includeDeleted ? letters : letters.filter(isLetterActive));
    });
  }

  /** @param {string} messageId */
  findById(messageId) {
    return this.#store.read((documents) => {
      const document = documents.get(messageId);
      return document ? createLetter(document) : null;
    });
  }

  /** @param {string} participantId */
  findByParticipant(participantId) {
    return this.#store.read((documents) =>
      sortChronologically(this.#all(documents).filter((l) => isLetterActive(l) && isAssignedTo(l, participantId))),
    );
  }

  findNeedingReview() {
    return this.#store.read((documents) =>
      sortChronologically(
        this.#all(documents).filter((l) => isLetterActive(l) && l.assignment.status === AssignmentStatus.NEEDS_REVIEW),
      ),
    );
  }

  /** @param {{ participantId?: string | null, messageIds?: string[] | null }} [filter] */
  markSeen({ participantId = null, messageIds = null } = {}) {
    const ids = messageIds ? new Set(messageIds) : null;
    return this.#store.write((documents) => {
      let count = 0;
      for (const [messageId, document] of documents) {
        if (document.seenByStaff === true || document.deletedAt) continue;
        if (ids && !ids.has(messageId)) continue;
        if (participantId && !isAssignedTo(createLetter(document), participantId)) continue;
        documents.set(messageId, { ...document, seenByStaff: true });
        count += 1;
      }
      return count;
    });
  }

  getKnownMessageIds() {
    return this.#store.read((documents) =>
      this.#all(documents).map((letter) => ({
        messageId: letter.messageId,
        contentHash: letter.contentHash,
        deletedAt: letter.deletedAt,
      })),
    );
  }

  deleteAll() {
    return this.#store.write((documents) => {
      const count = documents.size;
      documents.clear();
      return count;
    });
  }
}
