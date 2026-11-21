/**
 * Tests for the process manager behind ./start.sh and start.cmd.
 * The end-to-end test really starts and stops the web server (demo mode, temp dirs, free port).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { HELP, ROOT, UsageError, buildEnvFile, parseArgs, parseEnv, prettyLogLine } from '../../scripts/manage.js';

describe('manage.js arguments', () => {
  it('accepts commands as words or flags and defaults to start', () => {
    assert.equal(parseArgs([]).command, 'start');
    assert.equal(parseArgs(['--stop']).command, 'stop');
    assert.equal(parseArgs(['restart']).command, 'restart');
    assert.equal(parseArgs(['-h']).command, 'help');
    const options = parseArgs(['--demo', '--no-open', '--logs', '--follow', '--lines', '20']);
    assert.deepEqual(
      { command: options.command, demo: options.demo, open: options.open, follow: options.follow, lines: options.lines },
      { command: 'logs', demo: true, open: false, follow: true, lines: 20 },
    );
    assert.equal(parseArgs(['--stop', '--keep-mongo', '--force']).keepMongo, true);
  });

  it('rejects unknown options, two actions and invalid --lines', () => {
    assert.throws(() => parseArgs(['--foo']), UsageError);
    assert.throws(() => parseArgs(['--stop', '--start']), UsageError);
    assert.throws(() => parseArgs(['--logs', '--lines', 'x']), UsageError);
  });

  it('documents every action in the help text', () => {
    for (const action of ['--install', '--stop', '--restart', '--status', '--logs', '--auth', '--demo']) assert.ok(HELP.includes(action), action);
  });
});

describe('manage.js environment helpers', () => {
  it('parses .env files', () => {
    assert.deepEqual(parseEnv('# comentario\nA=1\nexport B="dos tres"\nC=4 # nota\nD=\n  \nmal formado'), { A: '1', B: 'dos tres', C: '4', D: '' });
  });

  it('creates .env with the same random MongoDB password in docker-compose vars and MONGODB_URI', () => {
    const example = 'MONGODB_URI=mongodb://retreat_admin:change-this-password@127.0.0.1:27017\nMONGO_ROOT_USERNAME=retreat_admin\nMONGO_ROOT_PASSWORD=change-this-password\n';
    const env = parseEnv(buildEnvFile(example, () => 'abc123'));
    assert.equal(env.MONGO_ROOT_PASSWORD, 'abc123');
    assert.equal(env.MONGODB_URI, 'mongodb://retreat_admin:abc123@127.0.0.1:27017');
    const random = parseEnv(buildEnvFile(example));
    assert.match(random.MONGO_ROOT_PASSWORD, /^[0-9a-f]{36}$/);
    assert.ok(random.MONGODB_URI.includes(random.MONGO_ROOT_PASSWORD));
  });

  it('formats pino log lines', () => {
    const line = prettyLogLine(JSON.stringify({ level: 30, time: '2026-11-21T10:00:00.000Z', pid: 1, role: 'web', msg: 'Ready', url: 'http://localhost:3000' }));
    assert.match(line, /INFO {2}Ready {2}url=http:\/\/localhost:3000/);
    assert.equal(prettyLogLine('texto plano'), 'texto plano');
  });
});

describe('manage.js end to end', () => {
  /** @type {string} */
  let directory;
  /** @type {Record<string, string>} */
  let env;

  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'retreat-manage-test-'));
    const port = await new Promise((resolve) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const { port: free } = /** @type {import('node:net').AddressInfo} */ (server.address());
        server.close(() => resolve(free));
      });
    });
    await writeFile(join(directory, 'test.env'), `PERSISTENCE=json\nPORT=${port}\n`);
    env = {
      ...process.env,
      RETREAT_ENV_FILE: join(directory, 'test.env'),
      RETREAT_RUN_DIR: join(directory, 'run'),
      DATA_DIR: join(directory, 'data'),
      EXPORT_DIR: join(directory, 'exports'),
      CACHE_DIR: join(directory, 'cache'),
      PARTICIPANTS_FILE: join(directory, 'participants.json'),
      NO_COLOR: '1',
    };
  });

  after(async () => {
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'manage.js'), '--stop', '--force'], { env, encoding: 'utf8' });
    await rm(directory, { recursive: true, force: true });
  });

  /** @param {string[]} args */
  const manage = (args) =>
    spawnSync(process.execPath, [join(ROOT, 'scripts', 'manage.js'), ...args], { env, encoding: 'utf8', timeout: 90_000 });

  it('starts in the background, reports status, restarts and stops', { timeout: 180_000 }, () => {
    const started = manage(['--demo', '--no-open']);
    assert.equal(started.status, 0, started.stderr || started.stdout);
    assert.match(started.stdout, /Panel en marcha \(PID \d+\)/);
    assert.ok(existsSync(join(directory, 'run', 'web.json')));

    const again = manage(['--demo', '--no-open']);
    assert.match(again.stdout, /ya está en marcha/);

    const status = manage(['--status']);
    assert.match(status.stdout, /Panel en marcha/);
    assert.match(status.stdout, /modo: demostración/);

    const logs = manage(['--logs', '--lines', '50']);
    assert.match(logs.stdout, /Mailbox sync finished/);

    const restarted = manage(['--restart', '--demo', '--no-open']);
    assert.equal(restarted.status, 0, restarted.stderr || restarted.stdout);
    assert.match(restarted.stdout, /Panel parado[^]*Panel en marcha/);

    const stopped = manage(['--stop']);
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.stdout, /Panel parado/);
    assert.equal(existsSync(join(directory, 'run', 'web.json')), false);
    assert.match(manage(['--status']).stdout, /Panel: parado/);
    assert.match(manage(['--stop']).stdout, /no estaba en marcha/);
  });
});
