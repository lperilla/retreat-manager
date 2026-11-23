import { AppError } from '../../domain/errors.js';
import { desiredLabels } from '../../domain/services/mailLabels.js';
import { zonedWallClockToInstant } from '../../domain/services/time.js';
import { normalizeText } from '../../domain/services/text.js';

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | undefined}
 */
function optionalText(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 200) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: `${field} must be a text of at most 200 characters` });
  }
  return value.trim();
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {boolean | undefined}
 */
function optionalBoolean(value, field) {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: `${field} must be true or false` });
}

/**
 * Mailbox view: letters with their participants, Gmail labels, print state and sync trace,
 * filterable by participant, label, sender, date and print state.
 * Reads the local database only (never Gmail).
 */
export class ListMailUseCase {
  #letters;
  #participants;
  #printStatuses;
  #states;
  #prefix;
  #printedLabel;
  #timeZone;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   labelStateRepository: import('../ports/LabelStateRepositoryPort.js').LabelStateRepositoryPort,
   *   prefix: string,
   *   printedLabel: string,
   *   timeZone: string,
   * }} deps
   */
  constructor({ letterStore, participantRepository, printStatusRepository, labelStateRepository, prefix, printedLabel, timeZone }) {
    this.#letters = letterStore;
    this.#participants = participantRepository;
    this.#printStatuses = printStatusRepository;
    this.#states = labelStateRepository;
    this.#prefix = prefix;
    this.#printedLabel = printedLabel;
    this.#timeZone = timeZone;
  }

  /**
   * @param {string | undefined} value YYYY-MM-DD
   * @param {string} field
   * @param {number} plusDays
   * @returns {Date | null}
   */
  #day(value, field, plusDays = 0) {
    if (!value) return null;
    const match = DAY.exec(value);
    if (!match) throw new AppError('INVALID_DATE', 400, undefined, { field });
    const [year, month, day] = match.slice(1).map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day + plusDays));
    return zonedWallClockToInstant({ year: probe.getUTCFullYear(), month: probe.getUTCMonth() + 1, day: probe.getUTCDate() }, this.#timeZone);
  }

  /**
   * @param {{
   *   participantId?: string, label?: string, sender?: string, from?: string, to?: string,
   *   printed?: boolean | string, hasAttachments?: boolean | string, limit?: number | string, offset?: number | string,
   * }} [input]  `from` / `to`: inclusive days (YYYY-MM-DD) in the retreat time zone.
   */
  async execute(input = {}) {
    const participantId = optionalText(input.participantId, 'participantId');
    const label = optionalText(input.label, 'label');
    const sender = optionalText(input.sender, 'sender');
    const printedFilter = optionalBoolean(input.printed, 'printed');
    const attachmentsFilter = optionalBoolean(input.hasAttachments, 'hasAttachments');
    const since = this.#day(optionalText(input.from, 'from'), 'from');
    const until = this.#day(optionalText(input.to, 'to'), 'to', 1);
    const limit = Math.min(200, Math.max(1, Number.parseInt(String(input.limit ?? 50), 10) || 50));
    const offset = Math.max(0, Number.parseInt(String(input.offset ?? 0), 10) || 0);

    const [letters, participants, printStatuses, states] = await Promise.all([
      this.#letters.findAll(),
      this.#participants.findAll(),
      this.#printStatuses.findAll(),
      this.#states.findAll(),
    ]);
    const participantsById = new Map(participants.map((p) => [p.id, p]));
    const printStatusById = new Map(printStatuses.map((s) => [s.participantId, s]));
    const stateById = new Map(states.map((s) => [s.messageId, s]));
    const labelKey = label ? normalizeText(label) : null;
    const senderKey = sender ? normalizeText(sender) : null;

    const rows = [];
    for (const letter of letters) {
      if (letter.deletedAt) continue;
      if (participantId && !letter.assignment.participantIds.includes(participantId)) continue;
      if (since && letter.receivedAt < since) continue;
      if (until && letter.receivedAt >= until) continue;
      if (senderKey && !normalizeText(letter.from).includes(senderKey)) continue;
      if (attachmentsFilter !== undefined && letter.attachments.length > 0 !== attachmentsFilter) continue;
      const desired = desiredLabels({ letter, participantsById, printStatusById, prefix: this.#prefix });
      if (printedFilter !== undefined && desired.printed !== printedFilter) continue;
      const state = stateById.get(letter.messageId) ?? null;
      const applied = [...(state?.labels ?? []), ...(state?.printed ? [this.#printedLabel] : [])];
      // The label filter matches what the message has (or should have) in Gmail.
      const shown = new Set([...applied, ...desired.labels, ...(desired.printed ? [this.#printedLabel] : [])]);
      if (labelKey && ![...shown].some((name) => normalizeText(name) === labelKey)) continue;
      const expected = [...desired.labels, ...(desired.printed ? [this.#printedLabel] : [])];
      rows.push({
        messageId: letter.messageId,
        threadId: letter.threadId,
        from: letter.from,
        subject: letter.subject,
        receivedAt: letter.receivedAt.toISOString(),
        attachmentCount: letter.attachments.length,
        hasAttachments: letter.attachments.length > 0,
        assignmentStatus: letter.assignment.status,
        participants: letter.assignment.participantIds.map((id) => ({ id, displayName: participantsById.get(id)?.displayName ?? id })),
        printed: desired.printed,
        labels: expected,
        gmail: {
          labels: applied,
          syncedAt: state?.syncedAt ? state.syncedAt.toISOString() : null,
          updatedBy: state?.updatedBy ?? null,
          error: state?.error ?? null,
          inSync: state === null ? expected.length === 0 : !state.error && sameSet(applied, expected),
        },
      });
    }
    rows.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return { total: rows.length, limit, offset, messages: rows.slice(offset, offset + limit) };
  }
}

/**
 * @param {string[]} a
 * @param {string[]} b
 */
function sameSet(a, b) {
  return a.length === b.length && [...a].sort().every((value, index) => value === [...b].sort()[index]);
}
