import { PrintStatusValue } from '../../domain/constants.js';
import { AppError } from '../../domain/errors.js';
import { markLettersPrinted, markLettersUnprinted, markPending, markPrinted, participantPrintState } from '../../domain/entities/PrintStatus.js';
import { resolveSelection } from '../../domain/services/batchSelection.js';
import { groupParticipantLetters } from '../../domain/services/grouping.js';
import { presentPrintStatus } from '../services/presenters.js';
import { oneOf, requireString, requireStringArray } from '../services/validation.js';

/**
 * Print status of one or more participants:
 * - without `messageIds`: every current letter becomes printed, or nothing is printed;
 * - with `messageIds`: only those letters change (printing the new letters, or one letter).
 */
export class UpdatePrintStatusUseCase {
  #participants;
  #letters;
  #printStatuses;
  #clock;
  #changes;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   changes?: import('../services/MailChangeRecorder.js').MailChangeRecorder | null,
   * }} deps
   */
  constructor({ participantRepository, letterStore, printStatusRepository, clock, changes = null }) {
    this.#participants = participantRepository;
    this.#letters = letterStore;
    this.#printStatuses = printStatusRepository;
    this.#clock = clock;
    this.#changes = changes;
  }

  /**
   * Marks ONE letter as printed (or not) for every participant it is assigned to.
   * @param {{ messageId: string, printed: boolean, actor?: string }} input
   */
  async setLetterPrinted(input) {
    const messageId = requireString(input?.messageId, 'messageId', { max: 200 });
    if (typeof input.printed !== 'boolean') throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'printed must be true or false' });
    const letter = await this.#letters.findById(messageId);
    if (!letter || letter.deletedAt) throw new AppError('LETTER_NOT_FOUND', 404, undefined, { messageId });
    if (letter.assignment.participantIds.length === 0) {
      throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'the letter is not assigned to any participant yet' });
    }
    return this.execute({
      participantIds: [...letter.assignment.participantIds],
      status: input.printed ? PrintStatusValue.PRINTED : PrintStatusValue.PENDING,
      messageIds: [messageId],
      actor: input.actor,
    });
  }

  /**
   * @param {{ participantIds: string[], status: string, messageIds?: string[], actor?: string }} input
   */
  async execute(input) {
    const requested = requireStringArray(input?.participantIds, 'participantIds');
    const status = oneOf(input.status, 'status', Object.values(PrintStatusValue), PrintStatusValue.PRINTED);
    const messageIds = input.messageIds === undefined || input.messageIds === null ? null : requireStringArray(input.messageIds, 'messageIds');
    const participantIds = resolveSelection(requested, await this.#participants.findAll());
    const now = this.#clock.now();
    const [letters, stored] = await Promise.all([this.#letters.findAll(), this.#printStatuses.findAll()]);
    const storedById = new Map(stored.map((s) => [s.participantId, s]));

    const updates = participantIds.map((id) => {
      const own = groupParticipantLetters(letters, id);
      const current = storedById.get(id) ?? null;
      if (messageIds === null) {
        return {
          own,
          status: status === PrintStatusValue.PRINTED ? markPrinted(id, now, own.map((letter) => letter.messageId)) : markPending(id),
        };
      }
      // Only letters of this participant change.
      const ownIds = new Set(own.map((letter) => letter.messageId));
      const targets = messageIds.filter((messageId) => ownIds.has(messageId));
      return {
        own,
        status:
          status === PrintStatusValue.PRINTED
            ? markLettersPrinted(current, id, targets, now, own)
            : markLettersUnprinted(current, id, targets, own),
      };
    });
    await this.#printStatuses.saveMany(updates.map((u) => u.status));
    // Traceability + Gmail label: the letters whose print state was requested to change.
    const touched = new Set(updates.flatMap((u, index) => (messageIds === null ? u.own.map((l) => l.messageId) : messageIds.filter((id) => u.own.some((l) => l.messageId === id)))));
    await this.#changes?.record({
      actor: input.actor,
      action: status === PrintStatusValue.PRINTED ? 'print.marked' : 'print.unmarked',
      messageIds: [...touched],
      participantIds,
    });
    return {
      updated: updates.length,
      statuses: updates.map((u) => presentPrintStatus(u.status.participantId, u.status, participantPrintState(u.status, u.own))),
    };
  }
}
