/**
 * Web entrypoint: dashboard + JSON API. The only entrypoint that schedules automatic syncs.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeError } from '../application/services/errorDescription.js';
import { createContainer } from '../composition/container.js';
import { PinoLogger } from '../infrastructure/logging/PinoLogger.js';
import { createWebApp } from '../infrastructure/web/createWebApp.js';
import { assertWebSecurity, listAccessUrls } from '../infrastructure/web/security/networkSecurity.js';
import { RetentionScheduler } from '../infrastructure/web/RetentionScheduler.js';
import { SyncScheduler } from '../infrastructure/web/SyncScheduler.js';
import { WebRuntime } from '../infrastructure/web/WebRuntime.js';
import { PROJECT_ROOT, loadEnvironment } from './bootstrap.js';

async function main() {
  const config = loadEnvironment();
  assertWebSecurity(config);
  const logger = PinoLogger.create({ level: config.logLevel, destination: 'stdout', bindings: { role: 'web' } });

  const runtime = await WebRuntime.create({
    config,
    logger,
    createContainer: (effectiveConfig) => createContainer({ config: effectiveConfig, role: 'web', overrides: { logger } }),
  });

  // Restarting from the dashboard is only possible when start.cmd / start.sh launched this process
  // (it records the PID in .run/web.json); then the same script stops and starts it again.
  try {
    const info = JSON.parse(readFileSync(join(PROJECT_ROOT, '.run', 'web.json'), 'utf8'));
    if (info.pid === process.pid) {
      runtime.setRestartHandler(() => {
        const child = spawn(process.execPath, [join(PROJECT_ROOT, 'scripts', 'manage.js'), 'restart', '--no-open', '--no-mongo'], {
          cwd: PROJECT_ROOT,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      });
    }
  } catch {
    // Not started through start.cmd: no restart button.
  }

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
    retention.stop();
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
    `retreat-manager web failed to start: ${describeError(error)}${details ? ` ${JSON.stringify(details)}` : ''}\n`,
  );
  process.exit(code === 'CONFIG_ERROR' ? 78 : 1);
});
