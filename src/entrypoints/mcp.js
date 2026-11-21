/**
 * MCP entrypoint (stdio). stdout carries ONLY protocol messages; every log goes to stderr.
 * Shares the database and use cases with the web dashboard; never schedules automatic syncs.
 */
import { readFile } from 'node:fs/promises';

import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { describeError } from '../application/services/errorDescription.js';
import { loadConfig } from '../composition/config.js';
import { createContainer } from '../composition/container.js';
import { PinoLogger } from '../infrastructure/logging/PinoLogger.js';
import { UnavailableMailSource } from '../infrastructure/mail/UnavailableMailSource.js';
import { createMcpServer } from '../infrastructure/mcp/createMcpServer.js';

dotenv.config({ quiet: true });

async function packageVersion() {
  try {
    const raw = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    return JSON.parse(raw).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main() {
  const config = loadConfig();
  const logger = PinoLogger.create({ level: config.logLevel, destination: 'stderr', bindings: { role: 'mcp' } });

  let container;
  try {
    container = await createContainer({ config, role: 'mcp', overrides: { logger } });
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code !== 'MAIL_SOURCE_NOT_CONFIGURED') throw error;
    // Reads keep working from the local store; sync_mailbox reports the missing configuration.
    logger.warn({ reason: describeError(error) }, 'Gmail is not configured; MCP tools will read the local store only');
    container = await createContainer({
      config,
      role: 'mcp',
      overrides: { logger, mailSource: new UnavailableMailSource(describeError(error)) },
    });
  }

  if (container.config.demoMode) {
    // Demo stores are in memory and per process: release wave 1 so the tools have data.
    const state = await container.repositories.syncStateRepository.get();
    if (!state.lastSuccessAt) await container.useCases.syncMailbox.execute({ mode: 'incremental' }).catch(() => {});
  }

  const server = createMcpServer({ getContainer: () => container, logger, version: await packageVersion() });
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await server.close().catch(() => {});
    await container.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  process.stdin.on('end', () => void shutdown());

  await server.connect(transport);
  logger.info({ demoMode: container.config.demoMode, persistence: container.config.demoMode ? 'memory' : config.persistence }, 'MCP server ready on stdio');
}

main().catch((error) => {
  const details = /** @type {{ details?: unknown }} */ (error)?.details;
  process.stderr.write(`retreat-mail-mcp MCP server failed to start: ${describeError(error)}${details ? ` ${JSON.stringify(details)}` : ''}\n`);
  process.exit(1);
});
