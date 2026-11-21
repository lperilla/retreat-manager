import { DEFAULTS } from '../../domain/constants.js';
import { buildBatchExportPayload } from '../../domain/services/batchSelection.js';
import { requireStringArray } from '../services/validation.js';

/**
 * Builds the renderer-agnostic payload for printing or exporting a batch of participants
 * (one section per participant, chronological letters).
 */
export class PreparePrintViewUseCase {
  #participants;
  #letters;
  #clock;
  #timeZone;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   timeZone?: string,
   * }} deps
   */
  constructor({ participantRepository, letterStore, clock, timeZone }) {
    this.#participants = participantRepository;
    this.#letters = letterStore;
    this.#clock = clock;
    this.#timeZone = timeZone ?? DEFAULTS.TIME_ZONE;
  }

  /**
   * @param {{ participantIds: string[], afterDate?: string | null }} input
   * @returns {Promise<Readonly<import('../../domain/entities/BatchExportPayload.js').BatchExportPayload>>}
   */
  async execute(input) {
    const participantIds = requireStringArray(input?.participantIds, 'participantIds', { allowEmpty: true });
    const [participants, letters] = await Promise.all([this.#participants.findAll(), this.#letters.findAll()]);
    return buildBatchExportPayload({
      participants,
      letters,
      participantIds,
      generatedAt: this.#clock.now(),
      timeZone: this.#timeZone,
      afterDate: input.afterDate ?? null,
    });
  }
}
