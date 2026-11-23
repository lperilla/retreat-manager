import { AppError } from '../../domain/errors.js';
import { describeError } from '../../application/services/errorDescription.js';

/**
 * Holds the container used by the web adapter. When Gmail credentials are missing the
 * dashboard starts in "setup" mode (no container) and staff can switch to demo mode from
 * the UI; the container is then created at runtime.
 */
export class WebRuntime {
  /** @type {any} */
  #container;
  #config;
  #startConfig;
  /** @type {(() => void) | null} */
  #restartHandler = null;
  #logger;
  #createContainer;
  /** @type {Array<(container: any) => void>} */
  #listeners = [];
  /** @type {Promise<void> | null} */
  #enabling = null;

  /**
   * @param {{
   *   config: import('../../composition/config.js').AppConfig,
   *   container: any,
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   *   createContainer: (config: import('../../composition/config.js').AppConfig) => Promise<any>,
   * }} options
   */
  constructor({ config, container, logger, createContainer }) {
    this.#config = config;
    this.#startConfig = config;
    this.#container = container;
    this.#logger = logger;
    this.#createContainer = createContainer;
  }

  /**
   * Creates the runtime; a missing mail source (no Gmail credentials) starts setup mode.
   * @param {{
   *   config: import('../../composition/config.js').AppConfig,
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   *   createContainer: (config: import('../../composition/config.js').AppConfig) => Promise<any>,
   * }} options
   */
  static async create({ config, logger, createContainer }) {
    try {
      const container = await createContainer(config);
      return new WebRuntime({ config, container, logger, createContainer });
    } catch (error) {
      if (/** @type {{ code?: string }} */ (error)?.code !== 'MAIL_SOURCE_NOT_CONFIGURED') throw error;
      logger.warn({ reason: describeError(error) }, 'Gmail is not configured; starting in setup mode (demo mode can be enabled from the UI)');
      return new WebRuntime({ config, container: null, logger, createContainer });
    }
  }

  get logger() {
    return this.#logger;
  }

  get config() {
    return this.#config;
  }

  /** Configuration this process started with (settings changed since then may need a restart). */
  get startConfig() {
    return this.#startConfig;
  }

  /**
   * Registers how to restart the app (only when it is managed by start.cmd / manage.js).
   * @param {(() => void) | null} handler
   */
  setRestartHandler(handler) {
    this.#restartHandler = handler;
  }

  get canRestart() {
    return this.#restartHandler !== null;
  }

  requestRestart() {
    if (!this.#restartHandler) throw new AppError('RESTART_UNAVAILABLE', 409);
    this.#restartHandler();
  }

  get setupRequired() {
    return this.#container === null;
  }

  /** The active container; throws MAIL_SOURCE_NOT_CONFIGURED (503) in setup mode. */
  get container() {
    if (!this.#container) throw new AppError('MAIL_SOURCE_NOT_CONFIGURED', 503);
    return this.#container;
  }

  /** @returns {any | null} */
  get containerOrNull() {
    return this.#container;
  }

  /**
   * @param {(container: any) => void} listener
   */
  onContainerReady(listener) {
    this.#listeners.push(listener);
    if (this.#container) listener(this.#container);
  }

  /** Switches to demo mode (in-memory stores + DemoMailSource). */
  async enableDemo() {
    if (this.#container?.config.demoMode) return;
    if (this.#container) {
      throw new AppError('VALIDATION_ERROR', 409, 'El modo demostración solo puede activarse cuando no hay credenciales de Gmail.');
    }
    if (!this.#enabling) {
      this.#enabling = (async () => {
        const container = await this.#createContainer({ ...this.#config, demoMode: true });
        this.#container = container;
        this.#logger.info('Demo mode enabled from the UI');
        for (const listener of this.#listeners) listener(container);
      })().finally(() => {
        this.#enabling = null;
      });
    }
    await this.#enabling;
  }

  /**
   * Applies a new configuration (saved settings) without restarting: builds a new container,
   * swaps it in and closes the old one. Refused while a sync is running. Demo mode keeps its
   * in-memory data, so it is never rebuilt (the settings apply the next time the app starts).
   * @param {import('../../composition/config.js').AppConfig} config
   * @returns {Promise<{ reloaded: boolean }>}
   */
  async reload(config) {
    const previous = this.#container;
    if (!previous || previous.config.demoMode) {
      this.#config = config;
      return { reloaded: false };
    }
    const state = await previous.repositories.syncStateRepository.get();
    if (state.lock && state.lock.owner && state.lock.expiresAt.getTime() > Date.now()) {
      throw new AppError('SYNC_IN_PROGRESS', 409, 'Hay una sincronización en curso. Espera a que termine para aplicar la configuración.');
    }
    const next = await this.#createContainer(config);
    this.#container = next;
    this.#config = config;
    await previous.close().catch((error) => this.#logger.warn({ err: describeError(error) }, 'Could not close the previous container'));
    this.#logger.info('Configuration reloaded from the dashboard');
    for (const listener of this.#listeners) listener(next);
    return { reloaded: true };
  }

  /** Public, non-sensitive information for the UI. */
  info() {
    const container = this.#container;
    return {
      setupRequired: container === null,
      demoMode: Boolean(container?.config.demoMode),
      timeZone: this.#config.timeZone,
      locale: 'es-ES',
      exportFormats: container ? container.useCases.exportBatchLetters.formats : [],
      accessControl: Boolean(this.#config.accessToken),
      syncIntervalMinutes: this.#config.sync.intervalMinutes,
      attachmentsAvailable: Boolean(container?.attachmentProcessor),
      maxAttachmentMb: this.#config.maxAttachmentMb,
      persistence: container ? (container.config.demoMode ? 'memory' : this.#config.persistence) : null,
    };
  }

  async close() {
    await this.#container?.close();
  }
}
