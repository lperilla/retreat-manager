import { PrintStatusValue } from '../../domain/constants.js';
import { markPending, markPrinted } from '../../domain/entities/PrintStatus.js';
import { resolveSelection } from '../../domain/services/batchSelection.js';
import { presentPrintStatus } from '../services/presenters.js';
import { oneOf, requireStringArray } from '../services/validation.js';

/**
 * Toggles print status (pending / printed) for one or more participants.
 */
export class UpdatePrintStatusUseCase {
  #participants;
  #printStatuses;
  #clock;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   * }} deps
   */
  constructor({ participantRepository, printStatusRepository, clock }) {
    this.#participants = participantRepository;
    this.#printStatuses = printStatusRepository;
    this.#clock = clock;
  }

  /**
   * @param {{ participantIds: string[], status: string }} input
   */
  async execute(input) {
    const requested = requireStringArray(input?.participantIds, 'participantIds');
    const status = oneOf(input.status, 'status', Object.values(PrintStatusValue), PrintStatusValue.PRINTED);
    const participantIds = resolveSelection(requested, await this.#participants.findAll());
    const now = this.#clock.now();
    const statuses = participantIds.map((id) =>
      status === PrintStatusValue.PRINTED ? markPrinted(id, now) : markPending(id),
    );
    await this.#printStatuses.saveMany(statuses);
    return { updated: statuses.length, statuses: statuses.map((s) => presentPrintStatus(s.participantId, s)) };
  }
}
