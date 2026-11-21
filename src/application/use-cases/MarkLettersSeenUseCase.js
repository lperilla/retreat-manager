import { AppError } from '../../domain/errors.js';
import { requireString, requireStringArray } from '../services/validation.js';

/**
 * "Marcar como vistas": globally, for one participant, or for specific letters.
 */
export class MarkLettersSeenUseCase {
  #letters;
  #participants;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   * }} deps
   */
  constructor({ letterStore, participantRepository }) {
    this.#letters = letterStore;
    this.#participants = participantRepository;
  }

  /**
   * @param {{ participantId?: string | null, messageIds?: string[] | null }} [input]
   */
  async execute(input = {}) {
    if (input.messageIds !== undefined && input.messageIds !== null) {
      const messageIds = requireStringArray(input.messageIds, 'messageIds', { max: 5000 });
      return { scope: 'letters', updated: await this.#letters.markSeen({ messageIds }) };
    }
    if (input.participantId !== undefined && input.participantId !== null) {
      const participantId = requireString(input.participantId, 'participantId', { max: 200 });
      if (!(await this.#participants.findById(participantId))) {
        throw new AppError('PARTICIPANT_NOT_FOUND', 404, undefined, { participantId });
      }
      return { scope: 'participant', participantId, updated: await this.#letters.markSeen({ participantId }) };
    }
    return { scope: 'all', updated: await this.#letters.markSeen({}) };
  }
}
