import { PrintStatusValue } from '../../domain/constants.js';
import { markLettersPrinted, markLettersUnprinted, markPending, markPrinted, participantPrintState } from '../../domain/entities/PrintStatus.js';
import { resolveSelection } from '../../domain/services/batchSelection.js';
import { groupParticipantLetters } from '../../domain/services/grouping.js';
import { presentPrintStatus } from '../services/presenters.js';
import { oneOf, requireStringArray } from '../services/validation.js';

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

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   * }} deps
   */
  constructor({ participantRepository, letterStore, printStatusRepository, clock }) {
    this.#participants = participantRepository;
    this.#letters = letterStore;
    this.#printStatuses = printStatusRepository;
    this.#clock = clock;
  }

  /**
   * @param {{ participantIds: string[], status: string, messageIds?: string[] }} input
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
    return {
      updated: updates.length,
      statuses: updates.map((u) => presentPrintStatus(u.status.participantId, u.status, participantPrintState(u.status, u.own))),
    };
  }
}
