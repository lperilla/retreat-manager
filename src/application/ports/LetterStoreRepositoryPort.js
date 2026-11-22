import { definePort } from './definePort.js';

/**
 * Local letter store. The dashboard reads ONLY from here.
 *
 * Semantics every adapter must honour:
 * - `upsertMany` inserts or replaces letters by `messageId`, but `firstSeenAt`, `syncRunId`
 *   and `seenByStaff` are insert-only: an existing letter keeps its stored values
 *   (novelty survives re-syncs and concurrent "Marcar como vistas").
 * - Soft-deleted letters (`deletedAt`) are returned only by `findAll({ includeDeleted: true })`,
 *   `findById` and `getKnownMessageIds`.
 * - Lists are returned in chronological order (receivedAt asc, messageId asc).
 *
 * @typedef {import('../../domain/entities/Letter.js').Letter} Letter
 * @typedef {import('../../domain/services/syncDiff.js').KnownLetterRef} KnownLetterRef
 *
 * @typedef {Object} AssignmentUpdate
 * @property {string} messageId
 * @property {import('../../domain/entities/Assignment.js').Assignment} assignment
 * @property {import('../../domain/entities/Letter.js').LetterFlag[]} flags
 *
 * @typedef {Object} LetterStoreRepositoryPort
 * @property {(letters: Letter[]) => Promise<{ inserted: number, updated: number }>} upsertMany
 * @property {(messageIds: string[], deletedAt: Date) => Promise<number>} softDeleteMany
 * @property {(updates: AssignmentUpdate[]) => Promise<number>} updateAssignments
 * @property {(options?: { includeDeleted?: boolean }) => Promise<Letter[]>} findAll
 * @property {(messageId: string) => Promise<Letter | null>} findById
 * @property {(participantId: string) => Promise<Letter[]>} findByParticipant  Active letters assigned to the participant.
 * @property {() => Promise<Letter[]>} findNeedingReview  Active NEEDS_REVIEW letters.
 * @property {(filter?: { participantId?: string | null, messageIds?: string[] | null }) => Promise<number>} markSeen
 *   Marks active letters as seen: all of them, those of one participant, or the given ids.
 * @property {() => Promise<KnownLetterRef[]>} getKnownMessageIds  Includes soft-deleted letters.
 * @property {() => Promise<number>} deleteAll
 * @property {(retreatId: string) => Promise<number>} assignRetreat  Stamps letters stored without a retreat (older versions).
 */

export const LetterStoreRepositoryPort = definePort('LetterStoreRepositoryPort', [
  'upsertMany',
  'softDeleteMany',
  'updateAssignments',
  'findAll',
  'findById',
  'findByParticipant',
  'findNeedingReview',
  'markSeen',
  'getKnownMessageIds',
  'deleteAll',
  'assignRetreat',
]);
