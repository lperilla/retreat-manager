import { DEFAULTS } from '../../domain/constants.js';
import { indexParticipantsById } from '../../domain/entities/Participant.js';
import { presentSyncRun } from '../services/presenters.js';
import { buildSyncStatusView } from '../services/syncStatusView.js';
import { integerInRange } from '../services/validation.js';

/**
 * Sync widget state (polled every 2 s while running) and sync history.
 */
export class GetSyncStatusUseCase {
  #syncState;
  #participants;
  #clock;
  #minIntervalSeconds;

  /**
   * @param {{
   *   syncStateRepository: import('../ports/SyncStateRepositoryPort.js').SyncStateRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   minIntervalSeconds?: number,
   * }} deps
   */
  constructor({ syncStateRepository, participantRepository, clock, minIntervalSeconds }) {
    this.#syncState = syncStateRepository;
    this.#participants = participantRepository;
    this.#clock = clock;
    this.#minIntervalSeconds = minIntervalSeconds ?? DEFAULTS.SYNC_MIN_INTERVAL_SECONDS;
  }

  async execute() {
    const [state, participants] = await Promise.all([this.#syncState.get(), this.#participants.findAll()]);
    return buildSyncStatusView(state, {
      now: this.#clock.now(),
      minIntervalSeconds: this.#minIntervalSeconds,
      participantsById: indexParticipantsById(participants),
    });
  }

  /**
   * @param {{ limit?: number }} [input]
   */
  async listRuns(input = {}) {
    const limit = integerInRange(input.limit, 'limit', { min: 1, max: 200, fallback: 20 });
    const runs = await this.#syncState.listRuns(limit);
    return { total: runs.length, runs: runs.map(presentSyncRun) };
  }
}
