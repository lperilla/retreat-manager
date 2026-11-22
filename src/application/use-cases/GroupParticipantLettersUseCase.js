import { DEFAULTS } from '../../domain/constants.js';
import { indexParticipantsById } from '../../domain/entities/Participant.js';
import { isNewLetter } from '../../domain/entities/Letter.js';
import { isLetterPrinted, participantPrintState } from '../../domain/entities/PrintStatus.js';
import { AppError } from '../../domain/errors.js';
import { groupParticipantLetters } from '../../domain/services/grouping.js';
import { presentLetter, presentPrintStatus } from '../services/presenters.js';
import { requireString } from '../services/validation.js';

/**
 * Chronological letters of one participant (detail view), each marked printed or not for them.
 */
export class GroupParticipantLettersUseCase {
  #participants;
  #letters;
  #printStatuses;
  #timeZone;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   timeZone?: string,
   * }} deps
   */
  constructor({ participantRepository, letterStore, printStatusRepository, timeZone }) {
    this.#participants = participantRepository;
    this.#letters = letterStore;
    this.#printStatuses = printStatusRepository;
    this.#timeZone = timeZone ?? DEFAULTS.TIME_ZONE;
  }

  /**
   * @param {{ participantId: string, afterDate?: string | null }} input
   */
  async execute(input) {
    const participantId = requireString(input?.participantId, 'participantId', { max: 200 });
    const participant = await this.#participants.findById(participantId);
    if (!participant) throw new AppError('PARTICIPANT_NOT_FOUND', 404, undefined, { participantId });

    const [participants, letters, printStatus] = await Promise.all([
      this.#participants.findAll(),
      this.#letters.findByParticipant(participantId),
      this.#printStatuses.findByParticipant(participantId),
    ]);
    const ordered = groupParticipantLetters(letters, participantId, {
      afterDate: input.afterDate ?? null,
      timeZone: this.#timeZone,
    });
    const participantsById = indexParticipantsById(participants);
    // Print state counts every letter of the participant, whatever the date filter.
    const all = groupParticipantLetters(letters, participantId, { timeZone: this.#timeZone });

    return {
      participant: { id: participant.id, displayName: participant.displayName, aliases: [...participant.aliases] },
      printStatus: presentPrintStatus(participant.id, printStatus, participantPrintState(printStatus, all)),
      afterDate: input.afterDate ?? null,
      timeZone: this.#timeZone,
      total: ordered.length,
      newCount: ordered.filter(isNewLetter).length,
      unprintedCount: ordered.filter((letter) => !isLetterPrinted(printStatus, letter)).length,
      letters: ordered.map((letter) => ({ ...presentLetter(letter, { participantsById }), printed: isLetterPrinted(printStatus, letter) })),
    };
  }
}
