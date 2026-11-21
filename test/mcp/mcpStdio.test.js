/**
 * End-to-end check of the real MCP entrypoint over stdio (demo mode): the client parses
 * every stdout line as JSON-RPC, so any stray output on stdout would break this test.
 * Logs must appear on stderr.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const entrypoint = fileURLToPath(new URL('../../src/entrypoints/mcp.js', import.meta.url));

describe('MCP stdio entrypoint', () => {
  it('speaks only JSON-RPC on stdout and logs to stderr', { timeout: 60_000 }, async () => {
    const exportDir = await mkdtemp(join(tmpdir(), 'retreat-mcp-stdio-'));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint],
      env: {
        ...process.env,
        DEMO_MODE: 'true',
        EXPORT_DIR: exportDir,
        LOG_LEVEL: 'info',
        SYNC_MIN_INTERVAL_SECONDS: '0',
      },
      stderr: 'pipe',
    });
    let stderr = '';
    transport.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    const protocolErrors = [];
    const client = new Client({ name: 'stdio-test', version: '1.0.0' });
    client.onerror = (error) => protocolErrors.push(error);

    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion()?.name, 'retreat-mail-mcp');
      assert.match(client.getInstructions() ?? '', /list_retreat_summary/);

      const result = await client.callTool({ name: 'list_retreat_summary', arguments: {} });
      assert.equal(/** @type {any} */ (result.structuredContent).totalLetters, 23);
      assert.deepEqual(protocolErrors, []);

      const logLines = stderr.split('\n').filter(Boolean).map((line) => JSON.parse(line));
      assert.ok(logLines.some((line) => line.msg === 'MCP server ready on stdio'));
      assert.ok(logLines.every((line) => line.role === 'mcp'));
    } finally {
      await client.close();
      await rm(exportDir, { recursive: true, force: true });
    }
  });
});
