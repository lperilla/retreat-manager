import { DEFAULTS, SyncMode } from '../../domain/constants.js';
import { createLetter, mergeIncomingLetter } from '../../domain/entities/Letter.js';
import { completeSyncRun, createSyncRun, failSyncRun, assertSyncMode } from '../../domain/entities/SyncRun.js';
import { FullSyncReason, createSyncResult } from '../../domain/entities/SyncResult.js';
import {
  cooldownRemainingSeconds,
  markSyncFailed,
  markSyncStarted,
  markSyncSucceeded,
} from '../../domain/entities/SyncState.js';
import { AppError, isAppError } from '../../domain/errors.js';
import { syncDiff } from '../../domain/services/syncDiff.js';
import { CursorExpiredError } from '../ports/MailSourcePort.js';
import { describeError } from '../services/errorDescription.js';
import { assembleLetter } from '../services/letterAssembly.js';

/**
 * @typedef {Object} SyncStart
 * @property {string} syncRunId
 * @property {string} requestedMode
 * @property {Date}   startedAt
 * @property {Promise<import('../../domain/entities/SyncResult.js').SyncResult>} completion
 *           Settles when the run finishes. Rejections are already observed, so callers that
 *           run the sync in the background may ignore it safely.
 */

/**
 * The only use case that talks to the mail source.
 *
 * Flow: cooldown → lock (TTL, renewed by a heartbeat) → read cursor → fetchChanges
 * (CursorExpiredError → full listing) → assignment (overrides win) + flags → syncDiff →
 * persist → advance cursor → append run → release lock (always).
 *
 * The cursor advances ONLY after the batch has been persisted. On failure the previous
 * cursor is kept, the state is marked `failed` with `lastError`, and the last good data
 * keeps being served.
 */
export class SyncMailboxUseCase {
  #mailSource;
  #letters;
  #syncState;
  #overrides;
  #participants;
  #strategy;
  #clock;
  #logger;
  #idGenerator;
  #ownerPrefix;
  #minIntervalSeconds;
  #lockTtlSeconds;
  #signatureOnlyMaxChars;
  #selectionKey;
  #activeRetreat;
  #onSynced;

  /**
   * @param {{
   *   mailSource: import('../ports/MailSourcePort.js').MailSourcePort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   syncStateRepository: import('../ports/SyncStateRepositoryPort.js').SyncStateRepositoryPort,
   *   overrideRepository: import('../ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   assignmentStrategy: import('../../domain/services/assignment.js').ContentAssignmentStrategy,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   logger: import('../ports/LoggerPort.js').LoggerPort,
   *   idGenerator: () => string,
   *   ownerPrefix?: string,
   *   minIntervalSeconds?: number,
   *   lockTtlSeconds?: number,
   *   signatureOnlyMaxChars?: number,
   *   selectionKey?: string | null,
   *   activeRetreat?: (() => Promise<{ id: string, mailFrom: Date | null } | null>) | null,
   *   onSynced?: ((result: import('../../domain/entities/SyncResult.js').SyncResult) => Promise<void>) | null,
   * }} deps
   */
  constructor({
    mailSource,
    letterStore,
    syncStateRepository,
    overrideRepository,
    participantRepository,
    assignmentStrategy,
    clock,
    logger,
    idGenerator,
    ownerPrefix = 'sync',
    minIntervalSeconds = DEFAULTS.SYNC_MIN_INTERVAL_SECONDS,
    lockTtlSeconds = DEFAULTS.SYNC_LOCK_TTL_SECONDS,
    signatureOnlyMaxChars,
    selectionKey = null,
    activeRetreat = null,
    onSynced = null,
  }) {
    this.#onSynced = onSynced;
    this.#mailSource = mailSource;
    this.#letters = letterStore;
    this.#syncState = syncStateRepository;
    this.#overrides = overrideRepository;
    this.#participants = participantRepository;
    this.#strategy = assignmentStrategy;
    this.#clock = clock;
    this.#logger = logger;
    this.#idGenerator = idGenerator;
    this.#ownerPrefix = ownerPrefix;
    this.#minIntervalSeconds = minIntervalSeconds;
    this.#lockTtlSeconds = lockTtlSeconds;
    this.#signatureOnlyMaxChars = signatureOnlyMaxChars;
    this.#selectionKey = selectionKey;
    this.#activeRetreat = activeRetreat;
  }

  /**
   * Runs a sync and waits for it to finish.
   * @param {{ mode?: string }} [input]
   */
  async execute(input = {}) {
    const { completion } = await this.start(input);
    return completion;
  }

  /**
   * Validates, enforces the cooldown and acquires the lock synchronously (so callers can
   * answer 429/409 immediately), then runs the sync in the background.
   * @param {{ mode?: string }} [input]
   * @returns {Promise<SyncStart>}
   */
  async start({ mode = SyncMode.INCREMENTAL } = {}) {
    const requestedMode = assertSyncMode(mode);
    const startedAt = this.#clock.now();

    const state = await this.#syncState.get();
    const retryAfterSeconds = cooldownRemainingSeconds(state, startedAt, this.#minIntervalSeconds);
    if (retryAfterSeconds > 0) {
      throw new AppError('SYNC_COOLDOWN', 429, undefined, { retryAfterSeconds });
    }

    const syncRunId = this.#idGenerator();
    const owner = `${this.#ownerPrefix}:${syncRunId}`;
    const acquired = await this.#syncState.acquireLock(owner, this.#lockTtlSeconds);
    if (!acquired) throw new AppError('SYNC_IN_PROGRESS', 409);

    const heartbeat = this.#startHeartbeat(owner);
    const completion = this.#run({ requestedMode, syncRunId, startedAt }).finally(async () => {
      clearInterval(heartbeat);
      try {
        await this.#syncState.releaseLock(owner);
      } catch (error) {
        this.#logger.error({ err: describeError(error), syncRunId }, 'Could not release the sync lock');
      }
    });
    completion.catch(() => {});
    return { syncRunId, requestedMode, startedAt, completion };
  }

  /**
   * Renews the lock while a long sync runs, so its TTL only matters if the process dies.
   * @param {string} owner
   * @returns {ReturnType<typeof setInterval>}
   */
  #startHeartbeat(owner) {
    const everyMs = Math.max(1000, Math.floor((this.#lockTtlSeconds * 1000) / 3));
    const timer = setInterval(() => {
      this.#syncState.acquireLock(owner, this.#lockTtlSeconds).catch((error) => {
        this.#logger.warn({ err: describeError(error) }, 'Could not renew the sync lock');
      });
    }, everyMs);
    timer.unref?.();
    return timer;
  }

  /**
   * @param {{ requestedMode: string, syncRunId: string, startedAt: Date }} run
   * @returns {Promise<import('../../domain/entities/SyncResult.js').SyncResult>}
   */
  async #run({ requestedMode, syncRunId, startedAt }) {
    let mode = requestedMode;
    const logger = this.#logger.child({ syncRunId });

    try {
      const initialState = await this.#syncState.get();
      await this.#syncState.save(markSyncStarted(initialState, { now: startedAt }));

      // The cursor only describes the mail selection it was built with (query, label, start
      // date). When that selection changes, an incremental sync would miss older matching
      // mail and keep letters that no longer match, so a full listing runs instead.
      const selectionChanged =
        this.#selectionKey !== null && initialState.historyId !== null && initialState.selectionKey !== this.#selectionKey;
      /** @type {string | null} */
      let fullSyncReason = null;
      if (requestedMode === SyncMode.FULL) fullSyncReason = FullSyncReason.REQUESTED;
      else if (initialState.historyId === null) fullSyncReason = FullSyncReason.FIRST_SYNC;
      else if (selectionChanged) fullSyncReason = FullSyncReason.SELECTION_CHANGED;
      const cursor = fullSyncReason === null ? initialState.historyId : null;
      if (cursor === null) mode = SyncMode.FULL;
      if (fullSyncReason === FullSyncReason.SELECTION_CHANGED) {
        logger.info('Mail source selection changed since the last sync; running a full sync');
      }
      logger.info({ requestedMode, mode }, 'Mailbox sync started');

      let changes;
      try {
        changes = await this.#mailSource.fetchChanges(cursor);
      } catch (error) {
        if (!(error instanceof CursorExpiredError) || cursor === null) throw error;
        logger.warn('Sync cursor expired; falling back to a full sync');
        mode = SyncMode.FULL;
        fullSyncReason = FullSyncReason.CURSOR_EXPIRED;
        changes = await this.#mailSource.fetchChanges(null);
      }
      if (!changes || !Array.isArray(changes.letters) || typeof changes.nextCursor !== 'string') {
        throw new Error('Mail source returned an invalid change set');
      }

      // Letters belong to the active retreat. Mail received before its window (letters of a
      // previous retreat whose data was already deleted) is never imported again.
      const retreat = this.#activeRetreat ? await this.#activeRetreat() : null;
      const mailFrom = retreat?.mailFrom ?? null;
      if (mailFrom) {
        const before = changes.letters.length;
        changes = { ...changes, letters: changes.letters.filter((m) => new Date(m.receivedAt).getTime() >= mailFrom.getTime()) };
        if (changes.letters.length < before) {
          logger.info({ ignored: before - changes.letters.length }, 'Letters older than the current retreat ignored');
        }
      }

      const [participants, known] = await Promise.all([
        this.#participants.findAll(),
        this.#letters.getKnownMessageIds(),
      ]);
      const incomingIds = changes.letters.map((message) => message.messageId);
      const overrides = await this.#overrides.findByMessageIds(incomingIds);
      const overrideById = new Map(overrides.map((override) => [override.messageId, override]));

      const incoming = changes.letters.map((message) =>
        assembleLetter(message, {
          participants,
          override: overrideById.get(message.messageId) ?? null,
          strategy: this.#strategy,
          signatureOnlyMaxChars: this.#signatureOnlyMaxChars,
        }),
      );

      let deletedMessageIds = [...(changes.deletedMessageIds ?? [])];
      if (changes.isFullListing) {
        const listed = new Set(incomingIds);
        const missing = known.filter((ref) => !ref.deletedAt && !listed.has(ref.messageId)).map((ref) => ref.messageId);
        deletedMessageIds = [...new Set([...deletedMessageIds, ...missing])];
      }

      const diff = syncDiff({ known, incoming, deletedMessageIds });
      const now = this.#clock.now();
      const toWrite = [
        ...diff.added.map((letter) => mergeIncomingLetter(null, letter, { now, syncRunId, retreatId: retreat?.id ?? null })),
        // Novelty fields are insert-only in the store, so updated letters keep theirs.
        ...diff.updated.map((letter) => createLetter({ ...letter, deletedAt: null })),
      ];
      if (toWrite.length > 0) await this.#letters.upsertMany(toWrite);
      if (diff.deleted.length > 0) await this.#letters.softDeleteMany(diff.deleted, now);

      const finishedAt = this.#clock.now();
      const result = createSyncResult({
        mode,
        requestedMode,
        fullSyncReason,
        added: diff.added.length,
        updated: diff.updated.length,
        unchanged: diff.unchanged.length,
        deleted: diff.deleted.length,
        perParticipantDeltas: diff.perParticipantDeltas,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        syncRunId,
      });

      // The batch is persisted: only now may the cursor advance.
      const latest = await this.#syncState.get();
      await this.#syncState.save(
        markSyncSucceeded(latest, {
          now: finishedAt,
          nextCursor: changes.nextCursor,
          result,
          ...(this.#selectionKey !== null ? { selectionKey: this.#selectionKey } : {}),
        }),
      );
      await this.#syncState.appendRun(
        completeSyncRun(createSyncRun({ id: syncRunId, type: mode, startedAt }), {
          finishedAt,
          added: result.added,
          updated: result.updated,
          deleted: result.deleted,
        }),
      );

      logger.info(
        { mode, added: result.added, updated: result.updated, deleted: result.deleted, durationMs: result.durationMs },
        'Mailbox sync finished',
      );
      // Follow-up work (Gmail labels) never turns a finished sync into a failed one.
      if (this.#onSynced) {
        try {
          await this.#onSynced(result);
        } catch (error) {
          logger.warn({ err: describeError(error) }, 'Post-sync step failed');
        }
      }
      return result;
    } catch (error) {
      const message = describeError(error);
      logger.error({ err: message, mode }, 'Mailbox sync failed');
      try {
        const failedAt = this.#clock.now();
        const latest = await this.#syncState.get();
        await this.#syncState.save(markSyncFailed(latest, { now: failedAt, error: message }));
        await this.#syncState.appendRun(
          failSyncRun(createSyncRun({ id: syncRunId, type: mode, startedAt }), { finishedAt: failedAt, error: message }),
        );
      } catch (recordError) {
        logger.error({ err: describeError(recordError) }, 'Could not record the failed sync run');
      }
      if (isAppError(error)) throw error;
      throw new AppError('SYNC_FAILED', 502, undefined, { cause: message });
    }
  }
}
