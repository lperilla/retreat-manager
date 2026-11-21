import { describeError } from '../../application/services/errorDescription.js';

const EXPECTED_REFUSALS = new Set(['SYNC_COOLDOWN', 'SYNC_IN_PROGRESS', 'MAIL_SOURCE_NOT_CONFIGURED']);

/**
 * Automatic incremental sync (web entrypoint only, SYNC_INTERVAL_MINUTES > 0).
 * Overlap with manual or MCP syncs is prevented by the database lock; a refused tick is
 * simply skipped.
 */
export class SyncScheduler {
  /** @type {ReturnType<typeof setInterval> | null} */
  #timer = null;
  #getSyncUseCase;
  #logger;
  #intervalMs;

  /**
   * @param {{
   *   intervalMinutes: number,
   *   getSyncUseCase: () => { start: (input: { mode: string }) => Promise<{ completion: Promise<unknown> }> },
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   * }} options
   */
  constructor({ intervalMinutes, getSyncUseCase, logger }) {
    this.#intervalMs = Math.round(intervalMinutes * 60_000);
    this.#getSyncUseCase = getSyncUseCase;
    this.#logger = logger;
  }

  get running() {
    return this.#timer !== null;
  }

  start() {
    if (this.#timer || this.#intervalMs <= 0) return;
    this.#timer = setInterval(() => {
      void this.tick();
    }, this.#intervalMs);
    this.#timer.unref?.();
    this.#logger.info({ intervalMinutes: this.#intervalMs / 60_000 }, 'Automatic sync scheduled');
  }

  /** Runs one scheduled sync attempt (exposed for tests). */
  async tick() {
    try {
      const started = await this.#getSyncUseCase().start({ mode: 'incremental' });
      started.completion.catch(() => {});
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code && EXPECTED_REFUSALS.has(code)) {
        this.#logger.debug({ code }, 'Scheduled sync skipped');
      } else {
        this.#logger.warn({ err: describeError(error) }, 'Scheduled sync could not start');
      }
    }
  }

  stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
