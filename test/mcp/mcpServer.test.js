import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { loadConfig } from '../../src/composition/config.js';
import { createContainer } from '../../src/composition/container.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { UnavailableMailSource } from '../../src/infrastructure/mail/UnavailableMailSource.js';
import { createMcpServer } from '../../src/infrastructure/mcp/createMcpServer.js';
import { buildTestContainer } from '../helpers/applicationFakes.js';

/** @type {string} */
let exportDir;
const cleanups = [];

before(async () => {
  exportDir = await mkdtemp(join(tmpdir(), 'retreat-mcp-'));
});
after(async () => {
  for (const cleanup of cleanups) await cleanup();
  await rm(exportDir, { recursive: true, force: true });
});

/**
 * Connects an in-memory MCP client to a server built on the given container.
 * @param {any} container
 */
async function connect(container) {
  const server = createMcpServer({ getContainer: () => container, logger: new NullLogger(), version: '0.0.0-test' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(async () => {
    await client.close();
    await server.close();
    await container.close();
  });
  return client;
}

async function demoClient() {
  const config = loadConfig({ DEMO_MODE: 'true', SYNC_MIN_INTERVAL_SECONDS: '0', EXPORT_DIR: exportDir, TZ: 'Europe/Madrid' });
  const container = await createContainer({ config, overrides: { logger: new NullLogger() } });
  await container.useCases.syncMailbox.execute();
  return connect(container);
}

/** @param {any} result */
const errorBody = (result) => JSON.parse(result.content[0].text);

describe('MCP tools', () => {
  it('exposes the six tools with input/output schemas and annotations', async () => {
    const client = await demoClient();
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));
    assert.deepEqual(
      [...byName.keys()].sort(),
      ['export_batch_letters', 'group_participant_letters', 'list_new_letters', 'list_retreat_summary', 'search_raw_letters', 'sync_mailbox'],
    );
    for (const name of ['list_retreat_summary', 'group_participant_letters', 'search_raw_letters', 'list_new_letters']) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, true, name);
    }
    for (const name of ['sync_mailbox', 'export_batch_letters']) {
      assert.equal(byName.get(name)?.annotations?.readOnlyHint, false, name);
      assert.equal(byName.get(name)?.annotations?.destructiveHint, false, name);
    }
    for (const tool of tools) assert.equal(tool.outputSchema?.type, 'object', `${tool.name} has an output schema`);
    assert.deepEqual(byName.get('search_raw_letters')?.inputSchema.required, ['query']);
    assert.equal(byName.get('search_raw_letters')?.inputSchema.properties?.limit?.maximum, 50);
  });

  it('list_retreat_summary returns counts with tie arrays and sync status', async () => {
    const client = await demoClient();
    const result = await client.callTool({ name: 'list_retreat_summary', arguments: {} });
    const summary = /** @type {any} */ (result.structuredContent);
    assert.equal(summary.totalLetters, 23);
    assert.deepEqual(summary.mostLetters, {
      count: 3,
      participants: [
        { id: 'lucia-fernandez', displayName: 'Lucía Fernández' },
        { id: 'pablo-ortega', displayName: 'Pablo Ortega' },
      ],
    });
    assert.deepEqual(summary.zeroLetterParticipants.map((p) => p.id), ['claudia-molina', 'hugo-serrano', 'raul-dominguez']);
    assert.equal(summary.fewestLetters.count, 0);
    assert.equal(summary.reviewQueueSize, 3);
    assert.equal(summary.newLettersCount, 23);
    assert.equal(summary.syncStatus, 'idle');
    assert.ok(summary.lastSyncAt);
    assert.equal(JSON.parse(/** @type {any} */ (result.content)[0].text).totalLetters, 23);
  });

  it('group_participant_letters returns chronological letters and honours an exclusive afterDate', async () => {
    const client = await demoClient();
    const all = /** @type {any} */ ((await client.callTool({ name: 'group_participant_letters', arguments: { participantId: 'lucia-fernandez' } })).structuredContent);
    assert.deepEqual(all.letters.map((l) => l.messageId), ['demo-w1-06', 'demo-w1-07', 'demo-w1-08']);
    assert.ok(all.letters[0].flags.some((f) => f.type === 'MULTI_RECIPIENT'));
    assert.equal(all.letters[1].assignment.signal, 'SUBJECT_EXPLICIT');
    assert.match(all.letters[1].body, /Es casi medianoche/);

    const after = /** @type {any} */ (
      (await client.callTool({ name: 'group_participant_letters', arguments: { participantId: 'lucia-fernandez', afterDate: '2026-11-18' } }))
        .structuredContent
    );
    assert.deepEqual(after.letters.map((l) => l.messageId), ['demo-w1-08']);
    assert.equal(after.timeZone, 'Europe/Madrid');
  });

  it('returns { code, message } errors for unknown participants', async () => {
    const client = await demoClient();
    const result = await client.callTool({ name: 'group_participant_letters', arguments: { participantId: 'nadie' } });
    assert.equal(result.isError, true);
    assert.deepEqual(errorBody(result), { code: 'PARTICIPANT_NOT_FOUND', message: 'Participante no encontrado.' });
  });

  it('search_raw_letters finds letters (including unassigned ones) and enforces limit <= 50', async () => {
    const client = await demoClient();
    const found = /** @type {any} */ ((await client.callTool({ name: 'search_raw_letters', arguments: { query: 'croquetas' } })).structuredContent);
    assert.deepEqual(found.results.map((r) => r.messageId), ['demo-w1-02']);
    assert.match(found.results[0].snippet, /croquetas/);

    const unassigned = /** @type {any} */ ((await client.callTool({ name: 'search_raw_letters', arguments: { query: 'mesa cocina' } })).structuredContent);
    assert.equal(unassigned.results[0].assignment.status, 'NEEDS_REVIEW');
    assert.deepEqual(unassigned.results[0].assignment.suggestions.map((s) => s.id), ['maria-garcia', 'maria-lopez']);

    const tooMany = await client.callTool({ name: 'search_raw_letters', arguments: { query: 'carta', limit: 51 } }).catch((error) => ({ isError: true, error }));
    assert.equal(tooMany.isError, true);
  });

  it('list_new_letters groups unseen letters by participant', async () => {
    const client = await demoClient();
    const fresh = /** @type {any} */ ((await client.callTool({ name: 'list_new_letters', arguments: {} })).structuredContent);
    assert.equal(fresh.total, 23);
    assert.equal(fresh.unassigned.count, 3);
    const juan = /** @type {any} */ ((await client.callTool({ name: 'list_new_letters', arguments: { participantId: 'juan-martinez' } })).structuredContent);
    assert.equal(juan.total, 2);
    assert.deepEqual(juan.groups.map((g) => g.participant.id), ['juan-martinez']);
  });

  it('sync_mailbox runs an incremental sync and reports per-participant deltas', async () => {
    const client = await demoClient();
    const result = /** @type {any} */ ((await client.callTool({ name: 'sync_mailbox', arguments: { mode: 'incremental' } })).structuredContent);
    assert.equal(result.added, 4);
    assert.equal(result.mode, 'incremental');
    assert.ok(result.perParticipantDeltas.some((d) => d.participantId === 'hugo-serrano' && d.displayName === 'Hugo Serrano'));
    assert.ok(result.lastSuccessAt);
  });

  it('export_batch_letters writes a file under EXPORT_DIR and returns its path', async () => {
    const client = await demoClient();
    const result = /** @type {any} */ (
      (await client.callTool({ name: 'export_batch_letters', arguments: { participantIds: ['lucia-fernandez', 'pablo-ortega'], format: 'txt' } }))
        .structuredContent
    );
    assert.ok(result.filePath.startsWith(exportDir));
    await access(result.filePath);
    assert.equal(result.participantCount, 2);
    assert.equal(result.letterCount, 6);
  });

  it('sync_mailbox reports MAIL_SOURCE_NOT_CONFIGURED when Gmail is not configured, while reads keep working', async () => {
    const { container } = await buildTestContainer({ mailSource: new UnavailableMailSource() });
    const client = await connect(container);
    const result = await client.callTool({ name: 'sync_mailbox', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(errorBody(result).code, 'MAIL_SOURCE_NOT_CONFIGURED');
    const summary = await client.callTool({ name: 'list_retreat_summary', arguments: {} });
    assert.equal(summary.isError, undefined);
    assert.equal(/** @type {any} */ (summary.structuredContent).syncStatus, 'failed');
  });
});

describe('MCP resources', () => {
  it('lists and reads summary, participants, sync status and per-participant letters', async () => {
    const client = await demoClient();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    for (const uri of ['retreat://summary', 'retreat://participants', 'retreat://sync-status', 'retreat://participants/lucia-fernandez/letters']) {
      assert.ok(uris.includes(uri), uri);
    }
    const { resourceTemplates } = await client.listResourceTemplates();
    assert.deepEqual(resourceTemplates.map((t) => t.uriTemplate), ['retreat://participants/{id}/letters']);

    const read = async (/** @type {string} */ uri) => JSON.parse(/** @type {any} */ ((await client.readResource({ uri })).contents[0]).text);
    assert.equal((await read('retreat://summary')).totalLetters, 23);
    assert.equal((await read('retreat://participants')).participants.length, 18);
    assert.equal((await read('retreat://sync-status')).status, 'idle');
    assert.equal((await read('retreat://participants/lucia-fernandez/letters')).total, 3);

    await assert.rejects(client.readResource({ uri: 'retreat://participants/nadie/letters' }), /Participante no encontrado/);
  });
});
