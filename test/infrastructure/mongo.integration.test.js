/**
 * MongoDB integration tests. They run only when MONGODB_URI_TEST is set, e.g.
 *   MONGODB_URI_TEST=mongodb://user:pass@127.0.0.1:27017
 * Each test uses a throwaway database (dropped afterwards); the configured MONGODB_DB is
 * never touched.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { MongoClient } from 'mongodb';

import { loadConfig } from '../../src/composition/config.js';
import { createContainer } from '../../src/composition/container.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { DemoMailSource } from '../../src/infrastructure/persistence/json/DemoMailSource.js';
import { COLLECTIONS } from '../../src/infrastructure/persistence/mongo/collections.js';
import { buildMongoRepositories, createMongoPersistence } from '../../src/infrastructure/persistence/mongo/createMongoPersistence.js';
import { ensureIndexes } from '../../src/infrastructure/persistence/mongo/indexes.js';
import { describeMongoTarget, inspectMongoUri } from '../../src/infrastructure/persistence/mongo/MongoConnection.js';
import { FakeClock } from '../helpers/applicationFakes.js';
import { makeLetter } from '../helpers/domainFixtures.js';
import { definePersistenceContract } from '../helpers/persistenceContract.js';

const uri = process.env.MONGODB_URI_TEST ?? '';
const skip = uri ? false : 'MONGODB_URI_TEST is not set';

/** @type {MongoClient | null} */
let client = null;
const createdDatabases = new Set();

const uniqueDbName = () => `retreat_mail_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

/**
 * @returns {Promise<MongoClient>}
 */
async function sharedClient() {
  if (!client) {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
  }
  return client;
}

/**
 * @param {string} name
 */
async function dropDatabase(name) {
  const mongo = await sharedClient();
  await mongo.db(name).dropDatabase();
  createdDatabases.delete(name);
}

after(async () => {
  if (!client) return;
  for (const name of [...createdDatabases]) await dropDatabase(name).catch(() => {});
  await client.close();
});

definePersistenceContract(
  'mongodb',
  async (clock) => {
    const mongo = await sharedClient();
    const name = uniqueDbName();
    createdDatabases.add(name);
    const db = mongo.db(name);
    await ensureIndexes(db, { runsTtlDays: 90 });
    return {
      clock,
      persistence: { kind: 'mongo', ...buildMongoRepositories(db, { clock }), close: async () => {} },
      cleanup: () => dropDatabase(name),
    };
  },
  { skip },
);

describe('MongoDB adapter specifics', { skip }, () => {
  /** @type {string} */
  let dbName;
  before(() => {
    dbName = uniqueDbName();
    createdDatabases.add(dbName);
  });

  it('creates the indexes idempotently at startup, including the sync_runs TTL', async () => {
    const logger = new NullLogger();
    const clock = new FakeClock();
    const first = await createMongoPersistence({ uri, dbName, clock, logger, runsTtlDays: 90 });
    await first.close();
    const second = await createMongoPersistence({ uri, dbName, clock, logger, runsTtlDays: 30 });
    await second.close();

    const mongo = await sharedClient();
    const letterIndexes = await mongo.db(dbName).collection(COLLECTIONS.LETTERS).indexes();
    const byName = new Map(letterIndexes.map((index) => [index.name, index]));
    assert.deepEqual(byName.get('participant_received_at')?.key, { 'assignment.participantIds': 1, receivedAt: 1 });
    assert.deepEqual(byName.get('assignment_status')?.key, { 'assignment.status': 1 });
    assert.deepEqual(byName.get('seen_by_staff')?.key, { seenByStaff: 1 });
    assert.deepEqual(byName.get('received_at')?.key, { receivedAt: 1 });

    const runIndexes = await mongo.db(dbName).collection(COLLECTIONS.SYNC_RUNS).indexes();
    const ttl = runIndexes.find((index) => index.name === 'started_at_ttl');
    assert.equal(ttl?.expireAfterSeconds, 30 * 24 * 60 * 60);
  });

  it('upserts are idempotent at the collection level (no duplicate documents)', async () => {
    const clock = new FakeClock();
    const persistence = await createMongoPersistence({ uri, dbName, clock, logger: new NullLogger() });
    try {
      const batch = [makeLetter({ messageId: 'dup-1' }), makeLetter({ messageId: 'dup-2' })];
      await persistence.letterStore.upsertMany(batch);
      await persistence.letterStore.upsertMany(batch);
      await persistence.letterStore.upsertMany(batch);
      const count = await persistence.db.collection(COLLECTIONS.LETTERS).countDocuments({ _id: { $in: ['dup-1', 'dup-2'] } });
      assert.equal(count, 2);
      const raw = await persistence.db.collection(COLLECTIONS.LETTERS).findOne({ _id: 'dup-1' });
      assert.ok(raw?.receivedAt instanceof Date);
      assert.equal(raw?.messageId, undefined);
    } finally {
      await persistence.close();
    }
  });

  it('runs the demo end to end through the container with Mongo persistence', async () => {
    const name = uniqueDbName();
    createdDatabases.add(name);
    const config = loadConfig({
      PERSISTENCE: 'mongo',
      MONGODB_URI: uri,
      MONGODB_DB: name,
      SYNC_MIN_INTERVAL_SECONDS: '0',
      PARTICIPANTS_FILE: './does-not-exist.json',
    });
    const { DEMO_PARTICIPANTS } = await import('../../src/infrastructure/persistence/json/demo/demoData.js');
    const container = await createContainer({
      config,
      overrides: {
        logger: new NullLogger(),
        clock: new FakeClock(),
        mailSource: new DemoMailSource(),
        participants: /** @type {any} */ ([...DEMO_PARTICIPANTS]),
      },
    });
    try {
      const wave1 = await container.useCases.syncMailbox.execute();
      assert.equal(wave1.added, 23);
      const again = await container.useCases.syncMailbox.execute({ mode: 'full' });
      assert.equal(again.added, 0);
      const wave2 = await container.useCases.syncMailbox.execute();
      assert.equal(wave2.added, 4);

      const { kpis, sync } = await container.useCases.getDashboardOverview.execute();
      assert.equal(kpis.totalLetters, 27);
      assert.equal(kpis.reviewQueueSize, 3);
      assert.equal(sync.status, 'idle');
      assert.equal(sync.hasCursor, true);
      assert.equal((await container.useCases.getSyncStatus.listRuns()).runs.length, 3);
    } finally {
      await container.close();
    }
  });

  it('refuses to start without a URI and reports an unreachable server', async () => {
    const logger = new NullLogger();
    const clock = new FakeClock();
    await assert.rejects(createMongoPersistence({ uri: '', dbName, clock, logger }), { code: 'CONFIG_ERROR' });
    await assert.rejects(
      createMongoPersistence({ uri: 'mongodb://u:p@127.0.0.1:1', dbName, clock, logger }),
      (error) => {
        assert.equal(error.code, 'DATABASE_UNAVAILABLE');
        assert.equal(JSON.stringify(error.details).includes('u:p@'), false);
        return true;
      },
    );
  });
});

describe('MongoDB URI helpers', () => {
  it('describes targets without credentials', () => {
    assert.equal(describeMongoTarget('mongodb://admin:s3cret@127.0.0.1:27017/?authSource=admin'), 'mongodb://127.0.0.1:27017');
    assert.equal(describeMongoTarget('mongodb+srv://u:p@cluster0.example.net/db'), 'mongodb+srv://cluster0.example.net');
    assert.equal(describeMongoTarget('nonsense'), 'mongodb://<invalid uri>');
    assert.deepEqual(inspectMongoUri('mongodb://u:p@localhost:27017,10.0.0.5:27018'), {
      hasCredentials: true,
      hosts: ['localhost', '10.0.0.5'],
    });
    assert.deepEqual(inspectMongoUri('mongodb://127.0.0.1'), { hasCredentials: false, hosts: ['127.0.0.1'] });
  });
});
