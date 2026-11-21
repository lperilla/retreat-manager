/**
 * Consistency checks for the project files delivered in phase 7: .env.example, README,
 * package.json scripts, .gitignore and the participants example.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { loadConfig } from '../../src/composition/config.js';
import { PROJECT_ROOT } from '../../src/entrypoints/bootstrap.js';
import { readParticipantsFile } from '../../src/infrastructure/persistence/json/participantsFile.js';

const read = (/** @type {string} */ file) => readFile(join(PROJECT_ROOT, file), 'utf8');

/** @param {string} text */
function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

describe('.env.example', () => {
  it('documents every variable read by the configuration and by docker-compose.yml', async () => {
    const example = parseEnvFile(await read('.env.example'));
    const config = await read('src/composition/config.js');
    const fromConfig = [...config.matchAll(/(?:text|bool|number)\(env, '([A-Z0-9_]+)'|path\('([A-Z0-9_]+)'/g)].map((m) => m[1] ?? m[2]);
    const compose = await read('docker-compose.yml');
    const fromCompose = [...compose.matchAll(/\$\{([A-Z0-9_]+)/g)].map((m) => m[1]);

    assert.ok(fromConfig.length >= 25, `found ${fromConfig.length} variables in config.js`);
    for (const name of new Set([...fromConfig, ...fromCompose])) {
      assert.ok(name in example, `${name} is missing from .env.example`);
    }
    for (const name of Object.keys(example)) {
      assert.ok(fromConfig.includes(name) || fromCompose.includes(name), `${name} in .env.example is not used anywhere`);
    }
  });

  it('contains only English comments and parses with the real config loader', async () => {
    const text = await read('.env.example');
    const values = parseEnvFile(text);
    const config = loadConfig({ ...values, PERSISTENCE: 'json' }, { rootDir: PROJECT_ROOT });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.timeZone, 'Europe/Madrid');
    assert.equal(config.assignment.minConfidence, 0.75);
    assert.equal(config.sync.runsTtlDays, 90);
    assert.equal(/[áéíóúñ¿¡]/i.test(text.split('\n').filter((l) => l.startsWith('#')).join('\n')), false);
    assert.equal(values.MONGODB_URI.includes(values.MONGO_ROOT_PASSWORD), true, 'MONGODB_URI matches the compose credentials');
  });
});

describe('package.json, .gitignore and examples', () => {
  it('defines the required scripts', async () => {
    const pkg = JSON.parse(await read('package.json'));
    for (const script of ['start', 'dev', 'mcp', 'auth', 'test', 'db:purge']) assert.ok(pkg.scripts[script], script);
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      assert.match(String(version), /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
    }
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.engines.node, '>=22');
  });

  it('ignores secrets and runtime personal data', async () => {
    const ignored = (await read('.gitignore')).split(/\r?\n/).map((l) => l.trim());
    for (const entry of ['node_modules/', '.env', 'credentials.json', 'token.json', 'data/', 'cache/', 'exports/']) {
      assert.ok(ignored.includes(entry), entry);
    }
  });

  it('ships a valid participants example', async () => {
    const participants = await readParticipantsFile(join(PROJECT_ROOT, 'participants.example.json'));
    assert.ok(participants && participants.length >= 3);
    assert.ok(participants.some((p) => p.aliases.length > 0));
  });
});

describe('README.md', () => {
  it('is in Spanish, covers the required sections and has valid JSON examples', async () => {
    const readme = await read('README.md');
    for (const heading of [
      'Arquitectura hexagonal',
      'Exportación en lote',
      'Configuración OAuth2 en Google Cloud',
      'Sincronización incremental',
      'MongoDB con Docker',
      'Servidor MCP',
      'Panel en la red local',
      'Impresión',
      'Privacidad, retención y borrado',
    ]) {
      assert.match(readme, new RegExp(`^## ${heading}$`, 'm'), heading);
    }
    assert.match(readme, /claude_desktop_config\.json/);
    for (const script of ['npm start', 'npm run mcp', 'npm run auth', 'npm test', 'npm run db:purge']) assert.ok(readme.includes(script), script);
    const jsonBlocks = [...readme.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]);
    assert.ok(jsonBlocks.length >= 2);
    for (const block of jsonBlocks) assert.doesNotThrow(() => JSON.parse(block));
  });
});
