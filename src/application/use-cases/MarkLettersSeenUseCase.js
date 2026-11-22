import { AppError } from '../../domain/errors.js';
import { requireString, requireStringArray } from '../services/validation.js';

/**
 * "Marcar como vistas": globally, for one participant, or for specific letters; specific
 * letters can also be marked as NOT seen again ("marcar como no leída").
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
   * @param {{ participantId?: string | null, messageIds?: string[] | null, seen?: boolean }} [input]  seen=false: only with messageIds.
   */
  async execute(input = {}) {
    const seen = input.seen !== false;
    if (input.messageIds !== undefined && input.messageIds !== null) {
      const messageIds = requireStringArray(input.messageIds, 'messageIds', { max: 5000 });
      if (!seen) return { scope: 'letters', seen: false, updated: await this.#letters.markUnseen({ messageIds }) };
      return { scope: 'letters', updated: await this.#letters.markSeen({ messageIds }) };
    }
    if (!seen) throw new AppError('VALIDATION_ERROR', 400, undefined, { field: 'messageIds', reason: 'marking as not seen needs the letters' });
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
