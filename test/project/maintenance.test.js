import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createAssignmentOverride } from '../../src/domain/entities/AssignmentOverride.js';
import { markPrinted } from '../../src/domain/entities/PrintStatus.js';
import { createSyncState } from '../../src/domain/entities/SyncState.js';
import { PROJECT_ROOT, loadEnvironment } from '../../src/entrypoints/bootstrap.js';
import { assertSafeDirectory, purgeData } from '../../src/infrastructure/maintenance/purgeData.js';
import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { PARTICIPANTS, makeLetter } from '../helpers/domainFixtures.js';
import { FakeClock } from '../helpers/applicationFakes.js';

/** @type {string} */
let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'retreat-maint-'));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

/**
 * @param {string} dataDir
 */
async function seed(dataDir) {
  const clock = new FakeClock();
  const persistence = createJsonPersistence({ directory: dataDir, clock });
  await persistence.letterStore.upsertMany([makeLetter({ messageId: 'a' }), makeLetter({ messageId: 'b', deletedAt: '2026-11-20T00:00:00Z' })]);
  await persistence.participantRepository.replaceAll([...PARTICIPANTS]);
  await persistence.overrideRepository.save(createAssignmentOverride({ messageId: 'a', participantIds: ['juan-perez'] }));
  await persistence.printStatusRepository.save(markPrinted('juan-perez', clock.now()));
  await persistence.syncStateRepository.save(createSyncState({ historyId: 'h-1' }));
  return persistence;
}

describe('purgeData', () => {
  it('deletes letters (incl. soft-deleted), overrides, print status and sync data; keeps participants by default', async () => {
    const persistence = await seed(join(directory, 'purge-a'));
    const report = await purgeData({ persistence, projectRoot: PROJECT_ROOT });
    assert.deepEqual(report, { letters: 2, overrides: 1, printStatuses: 1, syncState: true, participants: null, directories: [] });
    assert.deepEqual(await persistence.letterStore.findAll({ includeDeleted: true }), []);
    assert.equal((await persistence.syncStateRepository.get()).historyId, null);
    assert.equal((await persistence.participantRepository.findAll()).length, PARTICIPANTS.length);
  });

  it('optionally deletes participants and local directories', async () => {
    const persistence = await seed(join(directory, 'purge-b'));
    const exportsDir = join(directory, 'exports-b');
    await mkdir(exportsDir, { recursive: true });
    await writeFile(join(exportsDir, 'cartas.html'), 'x');
    const report = await purgeData({
      persistence,
      includeParticipants: true,
      directories: [exportsDir, join(directory, 'missing-cache')],
      projectRoot: PROJECT_ROOT,
    });
    assert.equal(report.participants, PARTICIPANTS.length);
    assert.deepEqual(report.directories.map((d) => d.removed), [true, false]);
    await assert.rejects(stat(exportsDir));
  });

  it('refuses to delete the project root, its ancestors or a filesystem root', () => {
    assert.throws(() => assertSafeDirectory(PROJECT_ROOT, PROJECT_ROOT), { code: 'CONFIG_ERROR' });
    assert.throws(() => assertSafeDirectory(resolve(PROJECT_ROOT, '..'), PROJECT_ROOT), { code: 'CONFIG_ERROR' });
    assert.throws(() => assertSafeDirectory(parse(PROJECT_ROOT).root, PROJECT_ROOT), { code: 'CONFIG_ERROR' });
    assert.equal(assertSafeDirectory(join(PROJECT_ROOT, 'exports'), PROJECT_ROOT), join(PROJECT_ROOT, 'exports'));
  });
});

describe('loadEnvironment', () => {
  it('reads .env from the project root (not the working directory) and resolves paths against it', async () => {
    const root = join(directory, 'fake-root');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, '.env'), 'PERSISTENCE=json\nEXPORT_DIR=./salidas\nPORT=4321\n');
    /** @type {Record<string, string>} */
    const env = {};
    const config = loadEnvironment({ env, rootDir: root });
    assert.equal(config.port, 4321);
    assert.equal(config.persistence, 'json');
    assert.equal(config.exportDir, join(root, 'salidas'));
    assert.equal(config.gmail.credentialsPath, join(root, 'credentials.json'));
    assert.equal(env.PORT, '4321');
  });

  it('does not override variables that are already set', async () => {
    const root = join(directory, 'fake-root-2');
    await mkdir(root, { recursive: true });
    await writeFile(join(root, '.env'), 'PORT=4321\n');
    const config = loadEnvironment({ env: { PORT: '5555' }, rootDir: root });
    assert.equal(config.port, 5555);
  });
});

describe('npm run db:purge (CLI)', () => {
  /**
   * @param {string[]} args
   * @param {string} [input]
   */
  function runPurge(args, input = '') {
    const dataDir = join(directory, 'cli-data');
    const envFile = join(directory, 'cli.env');
    return { dataDir, envFile, run: () => spawnSync(process.execPath, [join(PROJECT_ROOT, 'src', 'entrypoints', 'purge.js'), ...args], {
      env: { ...process.env, RETREAT_ENV_FILE: envFile, DEMO_MODE: 'false', PERSISTENCE: 'json', DATA_DIR: dataDir },
      input,
      encoding: 'utf8',
      timeout: 30_000,
    }) };
  }

  it('aborts without the confirmation word and purges with it', async () => {
    const { dataDir, envFile, run } = runPurge([]);
    await writeFile(envFile, '');
    await seed(join(dataDir, 'db'));

    const aborted = run.call(null);
    assert.equal(aborted.status, 0, aborted.stderr);
    assert.match(aborted.stdout, /Aborted: nothing was deleted/);
    assert.ok((await readdir(join(dataDir, 'db'))).includes('letters.json'));

    const confirmed = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src', 'entrypoints', 'purge.js')], {
      env: { ...process.env, RETREAT_ENV_FILE: envFile, DEMO_MODE: 'false', PERSISTENCE: 'json', DATA_DIR: dataDir },
      input: 'PURGE\n',
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(confirmed.status, 0, confirmed.stderr);
    assert.match(confirmed.stdout, /letters deleted: 2/);
    const reloaded = createJsonPersistence({ directory: join(dataDir, 'db'), clock: new FakeClock() });
    assert.deepEqual(await reloaded.letterStore.findAll({ includeDeleted: true }), []);
  });

  it('rejects unknown options and does nothing in demo mode', () => {
    const unknown = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src', 'entrypoints', 'purge.js'), '--everything'], {
      env: { ...process.env, RETREAT_ENV_FILE: join(directory, 'none.env') },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown option/);

    const demo = spawnSync(process.execPath, [join(PROJECT_ROOT, 'src', 'entrypoints', 'purge.js'), '--yes'], {
      env: { ...process.env, RETREAT_ENV_FILE: join(directory, 'none.env'), DEMO_MODE: 'true' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(demo.status, 0);
    assert.match(demo.stdout, /nothing to purge/);
  });
});
