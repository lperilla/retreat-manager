/**
 * Web entrypoint: dashboard + JSON API. The only entrypoint that schedules automatic syncs.
 */
import dotenv from 'dotenv';

import { describeError } from '../application/services/errorDescription.js';
import { loadConfig } from '../composition/config.js';
import { createContainer } from '../composition/container.js';
import { PinoLogger } from '../infrastructure/logging/PinoLogger.js';
import { createWebApp } from '../infrastructure/web/createWebApp.js';
import { assertWebSecurity, listAccessUrls } from '../infrastructure/web/security/networkSecurity.js';
import { SyncScheduler } from '../infrastructure/web/SyncScheduler.js';
import { WebRuntime } from '../infrastructure/web/WebRuntime.js';

dotenv.config({ quiet: true });

async function main() {
  const config = loadConfig();
  assertWebSecurity(config);
  const logger = PinoLogger.create({ level: config.logLevel, destination: 'stdout', bindings: { role: 'web' } });

  const runtime = await WebRuntime.create({
    config,
    logger,
    createContainer: (effectiveConfig) => createContainer({ config: effectiveConfig, role: 'web', overrides: { logger } }),
  });

  const scheduler = new SyncScheduler({
    intervalMinutes: config.sync.intervalMinutes,
    getSyncUseCase: () => runtime.container.useCases.syncMailbox,
    logger,
  });

  runtime.onContainerReady(async (container) => {
    scheduler.start();
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

  server.on('listening', () => {
    const { local, lan, exposed } = listAccessUrls({ host: config.host, port: config.port });
    for (const url of local) logger.info({ url }, 'Dashboard available on this computer');
    for (const url of lan) logger.info({ url }, 'Dashboard available on the local network');
    if (exposed) {
      logger.warn(
        { host: config.host, accessControl: Boolean(config.accessToken) },
        'The dashboard is EXPOSED ON THE LOCAL NETWORK: anyone on this network who knows ACCESS_TOKEN can read personal letters',
      );
    }
    if (runtime.setupRequired) logger.warn('Setup required: configure Gmail (npm run auth) or enable demo mode from the dashboard');
  });

  server.on('error', (error) => {
    logger.error({ err: describeError(error), host: config.host, port: config.port }, 'Web server could not start');
    process.exitCode = 1;
  });

  let closing = false;
  const shutdown = async (/** @type {string} */ signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Shutting down');
    scheduler.stop();
    server.close();
    await runtime.close().catch((error) => logger.error({ err: describeError(error) }, 'Error while closing'));
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  const code = /** @type {{ code?: string, details?: unknown }} */ (error)?.code;
  const details = /** @type {{ details?: unknown }} */ (error)?.details;
  process.stderr.write(
    `retreat-mail-mcp web failed to start: ${describeError(error)}${details ? ` ${JSON.stringify(details)}` : ''}\n`,
  );
  process.exit(code === 'CONFIG_ERROR' ? 78 : 1);
});
