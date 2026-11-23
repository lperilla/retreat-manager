/**
 * Starts the web server (dashboard + JSON API) and its schedulers, and returns a handle to stop it.
 * Shared by the command-line entrypoint (web.js) and the desktop app (Electron), which runs the
 * server inside its own process and must be able to start and stop it without exiting.
 */
import { renameSync, statSync } from 'node:fs';

import { describeError } from '../application/services/errorDescription.js';
import { createContainer } from '../composition/container.js';
import { PinoLogger } from '../infrastructure/logging/PinoLogger.js';
import { createWebApp } from '../infrastructure/web/createWebApp.js';
import { assertWebSecurity, listAccessUrls } from '../infrastructure/web/security/networkSecurity.js';
import { RetentionScheduler } from '../infrastructure/web/RetentionScheduler.js';
import { SyncScheduler } from '../infrastructure/web/SyncScheduler.js';
import { WebRuntime } from '../infrastructure/web/WebRuntime.js';
import { loadEnvironment } from './bootstrap.js';

const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Keeps one previous log file (`.1`) so a log never grows without limit.
 * @param {string} file
 */
function rotateLog(file) {
  try {
    if (statSync(file).size > MAX_LOG_BYTES) renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
}

/**
 * @param {{
 *   restartHandler?: (() => void) | null,
 *   logFile?: string | null,
 * }} [options]
 *   `restartHandler`: how the dashboard's "Reiniciar ahora" button restarts the app (none = no button).
 *   `logFile`: write the log to this file instead of the console.
 * @returns {Promise<{
 *   config: import('../composition/config.js').AppConfig,
 *   runtime: WebRuntime,
 *   urls: ReturnType<typeof listAccessUrls>,
 *   close: () => Promise<void>,
 * }>}
 *   Rejects when the configuration is invalid or the port cannot be used.
 */
export async function startWeb({ restartHandler = null, logFile = null } = {}) {
  const config = loadEnvironment();
  assertWebSecurity(config);
  if (logFile) rotateLog(logFile);
  const logger = PinoLogger.create({ level: config.logLevel, destination: 'stdout', file: logFile, bindings: { role: 'web' } });

  const runtime = await WebRuntime.create({
    config,
    logger,
    createContainer: (effectiveConfig) => createContainer({ config: effectiveConfig, role: 'web', overrides: { logger } }),
  });
  if (restartHandler) runtime.setRestartHandler(restartHandler);

  const scheduler = new SyncScheduler({
    intervalMinutes: config.sync.intervalMinutes,
    getSyncUseCase: () => runtime.container.useCases.syncMailbox,
    logger,
  });

  // Deletes the retreat's personal data automatically when its retention period is over.
  const retention = new RetentionScheduler({ getRetreatUseCase: () => runtime.container.useCases.retreat, logger });

  runtime.onContainerReady(async (container) => {
    scheduler.start();
    retention.start();
    if (!container.config.demoMode) return;
    // Demo mode: release wave 1 right away so the dashboard is not empty.
    const state = await container.repositories.syncStateRepository.get();
    if (state.lastSuccessAt) return;
    try {
      const started = await container.useCases.syncMailbox.start({ mode: 'incremental' });
      started.completion.catch(() => {});
    } catch (error) {
      logger.warn({ err: describeError(error) }, 'Initial demo sync could not start');
    }
  });

  const app = createWebApp({ runtime, logger, accessToken: config.accessToken });
  const server = app.listen(config.port, config.host);

  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
  } catch (error) {
    logger.error({ err: describeError(error), host: config.host, port: config.port }, 'Web server could not start');
    scheduler.stop();
    retention.stop();
    await runtime.close().catch(() => {});
    throw error;
  }

  const urls = listAccessUrls({ host: config.host, port: config.port });
  for (const url of urls.local) logger.info({ url }, 'Dashboard available on this computer');
  for (const url of urls.lan) logger.info({ url }, 'Dashboard available on the local network');
  if (urls.exposed) {
    logger.warn(
      { host: config.host, accessControl: Boolean(config.accessToken) },
      'The dashboard is EXPOSED ON THE LOCAL NETWORK: anyone on this network who knows ACCESS_TOKEN can read personal letters',
    );
  }
  if (runtime.setupRequired) logger.warn('Setup required: configure Gmail (npm run auth) or enable demo mode from the dashboard');

  let closed = false;
  return {
    config,
    runtime,
    urls,
    async close() {
      if (closed) return;
      closed = true;
      logger.info('Shutting down');
      scheduler.stop();
      retention.stop();
      server.close();
      server.closeAllConnections?.();
      await runtime.close().catch((error) => logger.error({ err: describeError(error) }, 'Error while closing'));
    },
  };
}
