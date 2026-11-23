import { createAuditEntry } from '../../domain/entities/AuditEntry.js';
import { createMailLabelState } from '../../domain/entities/MailLabelState.js';
import { AppError } from '../../domain/errors.js';
import { desiredLabels } from '../../domain/services/mailLabels.js';
import { normalizeActor } from '../services/MailChangeRecorder.js';

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

    const summary = { checked: 0, applied: 0, unchanged: 0, failed: 0, errors: /** @type {Array<{ messageId: string, error: string }>} */ ([]) };
    /** @type {Array<{ letter: any, desired: { labels: string[], printed: boolean }, change: import('../ports/MailLabelPort.js').LabelChange, added: string[], removed: string[] }>} */
    const pending = [];
    /** @type {import('../../domain/entities/MailLabelState.js').MailLabelState[]} */
    const cleared = [];

    for (const letter of allLetters) {
      if (letter.deletedAt || (only && !only.has(letter.messageId))) continue;
      summary.checked += 1;
      const desired = desiredLabels({ letter, participantsById, printStatusById, prefix: this.#prefix });
      const state = stateById.get(letter.messageId) ?? null;
      const applied = new Set(state?.labels ?? []);
      const want = new Set(desired.labels);
      const add = [...want].filter((name) => force || !applied.has(name));
      const remove = [...applied].filter((name) => !want.has(name));
      const printedApplied = state?.printed === true;
      if (desired.printed && (force || !printedApplied)) add.push(this.#printedLabel);
      if (!desired.printed && printedApplied) remove.push(this.#printedLabel);

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
          toSave.push(createMailLabelState({ messageId: id, labels: item.desired.labels, printed: item.desired.printed, syncedAt: now, updatedBy: who, error: null }));
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

    this.#logger.info({ checked: summary.checked, applied: summary.applied, unchanged: summary.unchanged, failed: summary.failed }, 'Gmail labels synchronized');
    return summary;
  }
}
