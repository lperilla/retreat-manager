/**
 * MCP server exposing the retreat letters (read from the local store) as tools and
 * resources. Shares the container (use cases + database) with the web dashboard.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import { describeError } from '../../application/services/errorDescription.js';
import { isAppError } from '../../domain/errors.js';
import {
  toMcpNewLetters,
  toMcpParticipantLetters,
  toMcpSearch,
  toMcpSummary,
  toMcpSyncResult,
} from './mappers.js';
import {
  exportBatchLettersInput,
  exportBatchLettersOutput,
  groupParticipantLettersInput,
  groupParticipantLettersOutput,
  listNewLettersInput,
  listNewLettersOutput,
  searchRawLettersInput,
  searchRawLettersOutput,
  summaryOutput,
  syncMailboxInput,
  syncMailboxOutput,
} from './schemas.js';

const READ_ONLY = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const SERVER_INSTRUCTIONS = [
  'Retreat letters received in a shared Gmail inbox, stored locally (tools never read Gmail directly, except sync_mailbox).',
  'Start with list_retreat_summary. Participants are identified by slug ids (e.g. "maria-garcia").',
  'Letters in the review queue (status NEEDS_REVIEW) count for nobody until staff assign them in the dashboard.',
  'Letters are personal and may concern minors: quote only what the user needs.',
].join(' ');

/**
 * Wraps a tool handler: structured content + JSON text, AppErrors as `{ code, message }`.
 * @template T
 * @param {import('../../application/ports/LoggerPort.js').LoggerPort} logger
 * @param {string} name
 * @param {(args: any) => Promise<T>} handler
 */
function tool(logger, name, handler) {
  return async (/** @type {any} */ args) => {
    try {
      const result = await handler(args ?? {});
      return {
        content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(result, null, 2) }],
        structuredContent: /** @type {Record<string, unknown>} */ (result),
      };
    } catch (error) {
      const body = isAppError(error)
        ? { code: error.code, message: error.message }
        : { code: 'INTERNAL_ERROR', message: 'Se ha producido un error interno.' };
      if (!isAppError(error) || error.httpStatus >= 500) logger.error({ tool: name, err: describeError(error) }, 'MCP tool failed');
      return { isError: true, content: [{ type: /** @type {const} */ ('text'), text: JSON.stringify(body) }] };
    }
  };
}

/**
 * @param {string} uri
 * @param {unknown} data
 */
function jsonResource(uri, data) {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] };
}

/**
 * Resource errors become JSON-RPC errors carrying the Spanish message.
 * @param {unknown} error
 * @returns {never}
 */
function resourceError(error) {
  if (isAppError(error)) {
    throw new McpError(error.httpStatus === 404 ? ErrorCode.InvalidParams : ErrorCode.InternalError, error.message, { code: error.code });
  }
  throw error;
}

/**
 * @param {{
 *   getContainer: () => any,
 *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
 *   version: string,
 * }} options
 * @returns {McpServer}
 */
export function createMcpServer({ getContainer, logger, version }) {
  const server = new McpServer({ name: 'retreat-mail-mcp', version }, { instructions: SERVER_INSTRUCTIONS });
  const useCases = () => getContainer().useCases;

  // ---------------------------------------------------------------- tools
  server.registerTool(
    'list_retreat_summary',
    {
      title: 'Retreat summary',
      description:
        'Counts of letters received, participants with and without letters, who has the most/fewest letters (all ties listed, 0-letter participants included), review queue size, new letters and sync status.',
      outputSchema: summaryOutput,
      annotations: READ_ONLY,
    },
    tool(logger, 'list_retreat_summary', async () => toMcpSummary(await useCases().getDashboardOverview.execute())),
  );

  server.registerTool(
    'group_participant_letters',
    {
      title: 'Letters of one participant',
      description:
        'All letters assigned to a participant in chronological order, with full bodies, heuristic flags and assignment evidence. Optional afterDate is exclusive.',
      inputSchema: groupParticipantLettersInput,
      outputSchema: groupParticipantLettersOutput,
      annotations: READ_ONLY,
    },
    tool(logger, 'group_participant_letters', async ({ participantId, afterDate }) =>
      toMcpParticipantLetters(await useCases().groupParticipantLetters.execute({ participantId, afterDate: afterDate ?? null })),
    ),
  );

  server.registerTool(
    'search_raw_letters',
    {
      title: 'Search letters',
      description:
        'Accent-insensitive search over subject, sender and body of every stored letter, including unassigned ones. Returns snippets (use group_participant_letters for full bodies).',
      inputSchema: searchRawLettersInput,
      outputSchema: searchRawLettersOutput,
      annotations: READ_ONLY,
    },
    tool(logger, 'search_raw_letters', async ({ query, limit }) =>
      toMcpSearch(await useCases().searchRawLetters.execute({ query, limit: limit ?? 20 })),
    ),
  );

  server.registerTool(
    'list_new_letters',
    {
      title: 'New letters',
      description: 'Letters not yet seen by staff, grouped by participant (unassigned ones listed separately).',
      inputSchema: listNewLettersInput,
      outputSchema: listNewLettersOutput,
      annotations: READ_ONLY,
    },
    tool(logger, 'list_new_letters', async ({ participantId }) =>
      toMcpNewLetters(await useCases().getNewLetters.execute({ participantId: participantId ?? null })),
    ),
  );

  server.registerTool(
    'sync_mailbox',
    {
      title: 'Synchronize mailbox',
      description:
        'Fetches new, changed and deleted letters from Gmail into the local store (incremental by default). Never deletes manual assignments or print status. Refused while another sync runs or during the cooldown.',
      inputSchema: syncMailboxInput,
      outputSchema: syncMailboxOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    tool(logger, 'sync_mailbox', async ({ mode }) => {
      const container = getContainer();
      const result = await container.useCases.syncMailbox.execute({ mode: mode ?? 'incremental' });
      const [participants, status] = await Promise.all([
        container.repositories.participantRepository.findAll(),
        container.useCases.getSyncStatus.execute(),
      ]);
      const names = new Map(participants.map((/** @type {any} */ p) => [p.id, p.displayName]));
      return toMcpSyncResult(result, names, status.lastSuccessAt);
    }),
  );

  server.registerTool(
    'export_batch_letters',
    {
      title: 'Export letters',
      description:
        'Writes the letters of the given participants to a file under EXPORT_DIR (html = printable packet with a page break per participant, txt or json) and returns its path. Content is not returned inline.',
      inputSchema: exportBatchLettersInput,
      outputSchema: exportBatchLettersOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    tool(logger, 'export_batch_letters', async ({ participantIds, format }) => {
      const result = await useCases().exportBatchLetters.execute({ participantIds, format });
      return {
        filePath: result.filePath,
        filename: result.filename,
        format: result.format,
        participantCount: result.participantCount,
        letterCount: result.letterCount,
      };
    }),
  );

  // ------------------------------------------------------------ resources
  server.registerResource(
    'summary',
    'retreat://summary',
    { title: 'Retreat summary', description: 'Letter counts, ties, review queue and sync status', mimeType: 'application/json' },
    async (uri) => {
      try {
        return jsonResource(uri.href, toMcpSummary(await useCases().getDashboardOverview.execute()));
      } catch (error) {
        return resourceError(error);
      }
    },
  );

  server.registerResource(
    'participants',
    'retreat://participants',
    { title: 'Participants', description: 'Participants with letter counts, new letters, warnings and print status', mimeType: 'application/json' },
    async (uri) => {
      try {
        const overview = await useCases().getDashboardOverview.execute();
        return jsonResource(uri.href, { total: overview.directory.total, participants: overview.directory.rows });
      } catch (error) {
        return resourceError(error);
      }
    },
  );

  server.registerResource(
    'participant-letters',
    new ResourceTemplate('retreat://participants/{id}/letters', {
      list: async () => {
        const participants = await getContainer().repositories.participantRepository.findAll();
        return {
          resources: participants.map((/** @type {any} */ p) => ({
            uri: `retreat://participants/${encodeURIComponent(p.id)}/letters`,
            name: `Cartas de ${p.displayName}`,
            mimeType: 'application/json',
          })),
        };
      },
      complete: {
        id: async (value) => {
          const participants = await getContainer().repositories.participantRepository.findAll();
          return participants.map((/** @type {any} */ p) => p.id).filter((id) => id.startsWith(value ?? ''));
        },
      },
    }),
    { title: 'Letters of a participant', description: 'Chronological letters of one participant', mimeType: 'application/json' },
    async (uri, variables) => {
      try {
        const id = decodeURIComponent(String(Array.isArray(variables.id) ? variables.id[0] : variables.id));
        return jsonResource(uri.href, toMcpParticipantLetters(await useCases().groupParticipantLetters.execute({ participantId: id })));
      } catch (error) {
        return resourceError(error);
      }
    },
  );

  server.registerResource(
    'sync-status',
    'retreat://sync-status',
    { title: 'Sync status', description: 'Last synchronization, current state and last error', mimeType: 'application/json' },
    async (uri) => {
      try {
        return jsonResource(uri.href, await useCases().getSyncStatus.execute());
      } catch (error) {
        return resourceError(error);
      }
    },
  );

  return server;
}
