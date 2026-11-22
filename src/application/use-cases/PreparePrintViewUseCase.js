import { DEFAULTS } from '../../domain/constants.js';
import { isLetterPrinted } from '../../domain/entities/PrintStatus.js';
import { buildBatchExportPayload } from '../../domain/services/batchSelection.js';
import { requireStringArray } from '../services/validation.js';

/**
 * Builds the renderer-agnostic payload for printing or exporting a batch of participants
 * (one section per participant, chronological letters). Optionally only some letters
 * (messageIds: one letter, the new ones of a participant) or only those not printed yet.
 */
export class PreparePrintViewUseCase {
  #participants;
  #letters;
  #printStatuses;
  #clock;
  #timeZone;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   printStatusRepository?: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   timeZone?: string,
   * }} deps
   */
  constructor({ participantRepository, letterStore, printStatusRepository, clock, timeZone }) {
    this.#participants = participantRepository;
    this.#letters = letterStore;
    this.#printStatuses = printStatusRepository ?? null;
    this.#clock = clock;
    this.#timeZone = timeZone ?? DEFAULTS.TIME_ZONE;
  }

  /**
   * @param {{ participantIds: string[], afterDate?: string | null, messageIds?: string[] | null, onlyUnprinted?: boolean }} input
   * @returns {Promise<Readonly<import('../../domain/entities/BatchExportPayload.js').BatchExportPayload>>}
   */
  async execute(input) {
    const participantIds = requireStringArray(input?.participantIds, 'participantIds', { allowEmpty: true });
    const messageIds = input.messageIds ? new Set(requireStringArray(input.messageIds, 'messageIds')) : null;
    const onlyUnprinted = input.onlyUnprinted === true && this.#printStatuses !== null;
    const [participants, letters, statuses] = await Promise.all([
      this.#participants.findAll(),
      this.#letters.findAll(),
      onlyUnprinted ? /** @type {import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort} */ (this.#printStatuses).findAll() : Promise.resolve([]),
    ]);
    const statusById = new Map(statuses.map((s) => [s.participantId, s]));
    /** @param {import('../../domain/entities/Letter.js').Letter} letter @param {string} participantId */
    const includeLetter = (letter, participantId) =>
      (!messageIds || messageIds.has(letter.messageId)) && (!onlyUnprinted || !isLetterPrinted(statusById.get(participantId), letter));
    return buildBatchExportPayload({
      includeLetter: messageIds || onlyUnprinted ? includeLetter : null,
      participants,
      letters,
      participantIds,
      generatedAt: this.#clock.now(),
      timeZone: this.#timeZone,
      afterDate: input.afterDate ?? null,
    });
  }
}
