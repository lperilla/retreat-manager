import { createAuditEntry } from '../../domain/entities/AuditEntry.js';
import { createMailLabelState } from '../../domain/entities/MailLabelState.js';
import { AppError } from '../../domain/errors.js';
import { desiredLabels } from '../../domain/services/mailLabels.js';
import { normalizeActor } from '../services/MailChangeRecorder.js';
import { describeError } from '../services/errorDescription.js';

const CHUNK = 100;

/**
 * Pushes to Gmail the labels each letter should carry (participant label + printed label).
 *
 * Idempotent: the local database decides what each message should have; `MailLabelState`
 * remembers what was applied, so a second run with no changes sends nothing. A failed
 * message keeps its previous state plus the error and is retried by the next run.
 * Authentication, permission and connection errors abort the run with a clear AppError.
 */
export class SyncMailLabelsUseCase {
  #letters;
  #participants;
  #printStatuses;
  #states;
  #labels;
  #audit;
  #clock;
  #idGenerator;
  #logger;
  #prefix;
  #printedLabel;
  /** @type {Promise<unknown> | null} */
  #running = null;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   labelStateRepository: import('../ports/LabelStateRepositoryPort.js').LabelStateRepositoryPort,
   *   labelPort: import('../ports/MailLabelPort.js').MailLabelPort | null,
   *   auditLog: import('../ports/AuditLogRepositoryPort.js').AuditLogRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   idGenerator: () => string,
   *   logger: import('../ports/LoggerPort.js').LoggerPort,
   *   prefix: string,
   *   printedLabel: string,
   * }} deps
   */
  constructor({ letterStore, participantRepository, printStatusRepository, labelStateRepository, labelPort, auditLog, clock, idGenerator, logger, prefix, printedLabel }) {
    this.#letters = letterStore;
    this.#participants = participantRepository;
    this.#printStatuses = printStatusRepository;
    this.#states = labelStateRepository;
    this.#labels = labelPort;
    this.#audit = auditLog;
    this.#clock = clock;
    this.#idGenerator = idGenerator;
    this.#logger = logger;
    this.#prefix = prefix;
    this.#printedLabel = printedLabel;
  }

  get enabled() {
    return this.#labels !== null;
  }

  /** Label settings and a summary of the stored state (for the dashboard). */
  async status() {
    const states = await this.#states.findAll();
    const synced = states.map((s) => s.syncedAt?.getTime() ?? 0);
    return {
      enabled: this.enabled,
      participantPrefix: this.#prefix,
      printedLabel: this.#printedLabel,
      labeledMessages: states.filter((s) => s.labels.length > 0 || s.printed).length,
      withErrors: states.filter((s) => s.error).length,
      lastSyncedAt: synced.length > 0 && Math.max(...synced) > 0 ? new Date(Math.max(...synced)).toISOString() : null,
    };
  }

  /**
   * Serialized: concurrent calls wait for the running one (no duplicated Gmail calls).
   * @param {{ actor?: unknown, messageIds?: string[] | null, force?: boolean }} [input]
   */
  async execute(input = {}) {
    while (this.#running) await this.#running.catch(() => {});
    const run = this.#run(input);
    this.#running = run;
    try {
      return await run;
    } finally {
      this.#running = null;
    }
  }

  /**
   * @param {{ actor?: unknown, messageIds?: string[] | null, force?: boolean }} input
   */
  async #run({ actor, messageIds = null, force = false }) {
    if (!this.#labels) throw new AppError('LABELS_DISABLED', 409);
    const labelPort = this.#labels;
    const who = normalizeActor(actor, 'sync');
    const only = messageIds ? new Set(messageIds) : null;

    const [allLetters, participants, printStatuses, states] = await Promise.all([
      this.#letters.findAll(),
      this.#participants.findAll(),
      this.#printStatuses.findAll(),
      this.#states.findAll(),
    ]);
    const participantsById = new Map(participants.map((p) => [p.id, p]));
    const printStatusById = new Map(printStatuses.map((s) => [s.participantId, s]));
    const stateById = new Map(states.map((s) => [s.messageId, s]));

    const summary = { checked: 0, applied: 0, unchanged: 0, failed: 0, deletedLabels: /** @type {string[]} */ ([]), errors: /** @type {Array<{ messageId: string, error: string }>} */ ([]) };
    /** @type {Array<{ letter: any, desired: { labels: string[], printed: boolean }, change: import('../ports/MailLabelPort.js').LabelChange, added: string[], removed: string[] }>} */
    const pending = [];
    const allDesired = new Set([this.#printedLabel]);
    /** Label names removed from messages in this run (candidates to delete when nobody uses them). */
    const removedNames = new Set();
    /** @type {import('../../domain/entities/MailLabelState.js').MailLabelState[]} */
    const cleared = [];

    for (const letter of allLetters) {
      if (letter.deletedAt || (only && !only.has(letter.messageId))) continue;
      summary.checked += 1;
      const desired = desiredLabels({ letter, participantsById, printStatusById, prefix: this.#prefix });
      const state = stateById.get(letter.messageId) ?? null;
      const applied = new Set(state?.labels ?? []);
      for (const name of desired.labels) allDesired.add(name);
      const want = new Set(desired.labels);
      const add = [...want].filter((name) => force || !applied.has(name));
      const remove = [...applied].filter((name) => !want.has(name));
      // The printed label may have been renamed since it was applied: the old name is removed too.
      const printedApplied = state?.printed ? (state.printedLabel ?? this.#printedLabel) : null;
      if (desired.printed && (force || printedApplied !== this.#printedLabel)) add.push(this.#printedLabel);
      if (printedApplied && (!desired.printed || printedApplied !== this.#printedLabel)) remove.push(printedApplied);

      if (add.length === 0 && remove.length === 0) {
        summary.unchanged += 1;
        // Nothing to send, but a stale error (or a first record) is brought up to date.
        if (state?.error) cleared.push(createMailLabelState({ ...state, error: null, updatedBy: who }));
        continue;
      }
      pending.push({ letter, desired, change: { messageId: letter.messageId, add, remove }, added: add, removed: remove });
    }

    if (cleared.length > 0) await this.#states.saveMany(cleared);

    for (let start = 0; start < pending.length; start += CHUNK) {
      const chunk = pending.slice(start, start + CHUNK);
      const results = await labelPort.applyChanges(chunk.map((item) => item.change));
      const resultById = new Map(results.map((r) => [r.messageId, r]));
      const now = this.#clock.now();
      const toSave = [];
      const entries = [];
      for (const item of chunk) {
        const id = item.letter.messageId;
        const previous = stateById.get(id) ?? null;
        const result = resultById.get(id);
        if (result?.ok) {
          summary.applied += 1;
          const saved = createMailLabelState({ messageId: id, labels: item.desired.labels, printed: item.desired.printed, printedLabel: item.desired.printed ? this.#printedLabel : null, syncedAt: now, updatedBy: who, error: null });
          toSave.push(saved);
          stateById.set(id, saved);
          item.removed.forEach((name) => removedNames.add(name));
          entries.push(
            createAuditEntry({
              id: this.#idGenerator(),
              at: now,
              actor: who,
              action: 'labels.applied',
              messageId: id,
              participantIds: item.letter.assignment.participantIds,
              details: { added: item.added, removed: item.removed },
            }),
          );
        } else {
          summary.failed += 1;
          const error = result?.error ?? 'Gmail did not confirm the change';
          summary.errors.push({ messageId: id, error });
          toSave.push(
            createMailLabelState({
              messageId: id,
              labels: previous?.labels ?? [],
              printed: previous?.printed ?? false,
              printedLabel: previous?.printedLabel ?? null,
              syncedAt: previous?.syncedAt ?? null,
              updatedBy: who,
              error,
            }),
          );
        }
      }
      await this.#states.saveMany(toSave);
      if (entries.length > 0) await this.#audit.appendMany(entries);
    }

    // Labels the app applied before (old prefix / old printed name) that no message carries any more
    // are deleted from Gmail so they do not pile up as empty labels.
    const stillUsed = new Set([...stateById.values()].flatMap((s) => [...s.labels, ...(s.printed ? [s.printedLabel ?? this.#printedLabel] : [])]));
    const retired = [...removedNames].filter((name) => !stillUsed.has(name) && !allDesired.has(name));
    if (retired.length > 0 && typeof labelPort.deleteLabels === 'function') {
      try {
        const deleted = await labelPort.deleteLabels(retired);
        summary.deletedLabels = deleted;
      } catch (error) {
        this.#logger.warn({ err: describeError(error) }, 'Old Gmail labels could not be deleted');
      }
    }

    this.#logger.info({ checked: summary.checked, applied: summary.applied, unchanged: summary.unchanged, failed: summary.failed }, 'Gmail labels synchronized');
    return summary;
  }
}
