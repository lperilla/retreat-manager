import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createLetter } from '../../src/domain/entities/Letter.js';
import { createSyncRun } from '../../src/domain/entities/SyncRun.js';
import { createSyncState } from '../../src/domain/entities/SyncState.js';
import { createAssignmentOverride } from '../../src/domain/entities/AssignmentOverride.js';
import { markPrinted } from '../../src/domain/entities/PrintStatus.js';
import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { readParticipantsFile } from '../../src/infrastructure/persistence/json/participantsFile.js';
import { FileExportStorage } from '../../src/infrastructure/rendering/FileExportStorage.js';
import { PARTICIPANTS, assignedTo, makeLetter } from '../helpers/domainFixtures.js';
import { FakeClock } from '../helpers/applicationFakes.js';

/** @type {string} */
let directory;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'retreat-json-'));
});
after(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('JSON persistence', () => {
  it('persists every repository to disk and reloads it in a new instance', async () => {
    const dir = join(directory, 'roundtrip');
    const clock = new FakeClock();
    const first = createJsonPersistence({ directory: dir, clock });
    const letter = makeLetter({ messageId: 'r1', cleanBody: 'Querida Begoña:\n\nÁnimo 😊', assignment: assignedTo(['juan-perez']) });

    await first.letterStore.upsertMany([letter]);
    await first.participantRepository.replaceAll([...PARTICIPANTS]);
    await first.printStatusRepository.save(markPrinted('juan-perez', clock.now()));
    await first.overrideRepository.save(createAssignmentOverride({ messageId: 'r1', participantIds: ['juan-perez'] }));
    await first.syncStateRepository.save(createSyncState({ historyId: 'h-9' }));

    const second = createJsonPersistence({ directory: dir, clock });
    const reloaded = await second.letterStore.findById('r1');
    assert.equal(reloaded?.cleanBody, 'Querida Begoña:\n\nÁnimo 😊');
    assert.equal(reloaded?.receivedAt.toISOString(), letter.receivedAt.toISOString());
    assert.equal((await second.participantRepository.findAll()).length, PARTICIPANTS.length);
    assert.equal((await second.printStatusRepository.findByParticipant('juan-perez'))?.status, 'printed');
    assert.deepEqual((await second.overrideRepository.findByMessageId('r1'))?.participantIds, ['juan-perez']);
    assert.equal((await second.syncStateRepository.get()).historyId, 'h-9');

    const raw = JSON.parse(await readFile(join(dir, 'letters.json'), 'utf8'));
    assert.equal(raw.version, 1);
  });

  it('upsertMany keeps insert-only novelty fields of existing letters', async () => {
    const { letterStore } = createJsonPersistence({ directory: null, clock: new FakeClock() });
    const firstSeenAt = new Date('2026-11-20T08:00:00Z');
    const stored = makeLetter({ messageId: 'n', firstSeenAt, syncRunId: 'run-1', seenByStaff: false });
    await letterStore.upsertMany([stored]);
    await letterStore.markSeen({ messageIds: ['n'] });

    const update = createLetter({ ...stored, cleanBody: 'Editado', firstSeenAt: null, syncRunId: 'run-2', seenByStaff: false });
    assert.deepEqual(await letterStore.upsertMany([update]), { inserted: 0, updated: 1 });

    const result = await letterStore.findById('n');
    assert.equal(result?.cleanBody, 'Editado');
    assert.equal(result?.seenByStaff, true);
    assert.equal(result?.syncRunId, 'run-1');
    assert.equal(result?.firstSeenAt?.toISOString(), firstSeenAt.toISOString());
  });

  it('soft-deletes, excludes deleted letters from queries and keeps them as known ids', async () => {
    const { letterStore } = createJsonPersistence({ directory: null, clock: new FakeClock() });
    await letterStore.upsertMany([
      makeLetter({ messageId: 'a', assignment: assignedTo(['juan-perez']) }),
      makeLetter({ messageId: 'b', assignment: assignedTo(['juan-perez']) }),
    ]);
    assert.equal(await letterStore.softDeleteMany(['a', 'a', 'missing'], new Date('2026-11-21T00:00:00Z')), 1);
    assert.deepEqual((await letterStore.findByParticipant('juan-perez')).map((l) => l.messageId), ['b']);
    assert.equal((await letterStore.findAll({ includeDeleted: true })).length, 2);
    const known = await letterStore.getKnownMessageIds();
    assert.ok(known.find((k) => k.messageId === 'a')?.deletedAt);
    assert.equal(await letterStore.markSeen({ messageIds: ['a'] }), 0);
  });

  it('acquires the lock atomically, renews it for the same owner and keeps it across save()', async () => {
    const clock = new FakeClock();
    const { syncStateRepository } = createJsonPersistence({ directory: null, clock });
    const results = await Promise.all([
      syncStateRepository.acquireLock('owner-a', 60),
      syncStateRepository.acquireLock('owner-b', 60),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    const holder = (await syncStateRepository.get()).lock?.owner;
    assert.ok(holder);

    await syncStateRepository.save(createSyncState({ historyId: 'h-1' }));
    assert.equal((await syncStateRepository.get()).lock?.owner, holder);
    assert.equal(await syncStateRepository.acquireLock(/** @type {string} */ (holder), 60), true);
    assert.equal(await syncStateRepository.releaseLock('someone-else'), false);
    assert.equal(await syncStateRepository.releaseLock(/** @type {string} */ (holder)), true);
    assert.equal((await syncStateRepository.get()).lock, null);
  });

  it('prunes sync runs older than SYNC_RUNS_TTL_DAYS and lists the newest first', async () => {
    const clock = new FakeClock('2026-11-21T10:00:00Z');
    const { syncStateRepository } = createJsonPersistence({ directory: null, clock, runsTtlDays: 30 });
    const run = (id, startedAt) => createSyncRun({ id, type: 'incremental', startedAt, status: 'success', finishedAt: startedAt });
    await syncStateRepository.appendRun(run('old', '2026-09-01T00:00:00Z'));
    await syncStateRepository.appendRun(run('recent', '2026-11-20T00:00:00Z'));
    await syncStateRepository.appendRun(run('newest', '2026-11-21T09:00:00Z'));
    assert.deepEqual((await syncStateRepository.listRuns(10)).map((r) => r.id), ['newest', 'recent']);
  });

  it('rejects duplicate participant ids', async () => {
    const { participantRepository } = createJsonPersistence({ directory: null, clock: new FakeClock() });
    await assert.rejects(participantRepository.replaceAll([PARTICIPANTS[0], PARTICIPANTS[0]]), { code: 'DUPLICATE_PARTICIPANT' });
  });
});

describe('participants file', () => {
  it('reads arrays or { participants } objects and returns null when missing', async () => {
    const arrayFile = join(directory, 'participants-array.json');
    await writeFile(arrayFile, JSON.stringify([{ displayName: 'Íñigo Núñez', aliases: ['Iñi'] }]), 'utf8');
    const fromArray = await readParticipantsFile(arrayFile);
    assert.deepEqual(fromArray?.map((p) => p.id), ['inigo-nunez']);

    const objectFile = join(directory, 'participants-object.json');
    await writeFile(objectFile, `\uFEFF${JSON.stringify({ participants: [{ id: 'ana', displayName: 'Ana' }] })}`, 'utf8');
    assert.deepEqual((await readParticipantsFile(objectFile))?.map((p) => p.id), ['ana']);

    assert.equal(await readParticipantsFile(join(directory, 'missing.json')), null);

    const broken = join(directory, 'broken.json');
    await writeFile(broken, '{ nope', 'utf8');
    await assert.rejects(readParticipantsFile(broken), { code: 'CONFIG_ERROR' });
  });
});

describe('FileExportStorage', () => {
  it('writes inside EXPORT_DIR and rejects unsafe filenames', async () => {
    const storage = new FileExportStorage({ exportDir: join(directory, 'exports') });
    const { filePath } = await storage.save('cartas_juan_20261121-100000.txt', 'Hola');
    assert.equal(await readFile(filePath, 'utf8'), 'Hola');
    for (const name of ['../escape.txt', 'sub/dir.txt', '..\\escape.txt', '.hidden', 'C:\\x.txt', '']) {
      await assert.rejects(storage.save(name, 'x'), { code: 'VALIDATION_ERROR' }, name);
    }
  });
});
