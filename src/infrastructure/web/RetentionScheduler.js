import { describeError } from '../../application/services/errorDescription.js';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Automatic deletion of the retreat's personal data once its retention period is over:
 * checked when the dashboard starts and then every hour.
 */
export class RetentionScheduler {
  /** @type {ReturnType<typeof setInterval> | null} */
  #timer = null;
  #getRetreatUseCase;
  #logger;
  #intervalMs;

  /**
   * @param {{
   *   getRetreatUseCase: () => { enforceRetention: () => Promise<boolean> },
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   *   intervalMs?: number,
   * }} options
   */
  constructor({ getRetreatUseCase, logger, intervalMs = HOUR_MS }) {
    this.#getRetreatUseCase = getRetreatUseCase;
    this.#logger = logger;
    this.#intervalMs = intervalMs;
  }

  start() {
    if (this.#timer) return;
    void this.tick();
    this.#timer = setInterval(() => void this.tick(), this.#intervalMs);
    this.#timer.unref?.();
  }

  /** One check (exposed for tests). */
  async tick() {
    try {
      await this.#getRetreatUseCase().enforceRetention();
    } catch (error) {
      this.#logger.error({ err: describeError(error) }, 'Automatic deletion of the retreat data failed; it will be retried');
    }
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
