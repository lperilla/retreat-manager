import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadConfig } from '../../src/composition/config.js';
import { createContainer } from '../../src/composition/container.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { describeError, redactSecrets } from '../../src/application/services/errorDescription.js';
import { AppError } from '../../src/domain/errors.js';

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = loadConfig({}, { rootDir: '/srv/app' });
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.timeZone, 'Europe/Madrid');
    assert.equal(config.persistence, 'mongo');
    assert.equal(config.demoMode, false);
    assert.equal(config.assignment.minConfidence, 0.75);
    assert.equal(config.assignment.bodyScanChars, 600);
    assert.equal(config.maxAttachmentMb, 15);
    assert.equal(config.mongo.db, 'retreat_mail');
    assert.deepEqual(config.sync, { intervalMinutes: 0, minIntervalSeconds: 30, lockTtlSeconds: 300, runsTtlDays: 90 });
    assert.equal(config.exportDir, resolve('/srv/app', 'exports'));
    assert.equal(config.participantsFile, resolve('/srv/app', 'data', 'participants.json'));
    assert.equal(config.accessToken, null);
  });

  it('parses and validates values', () => {
    const config = loadConfig({ DEMO_MODE: 'yes', PORT: '8080', PERSISTENCE: 'JSON', ASSIGNMENT_MIN_CONFIDENCE: '0.8' });
    assert.equal(config.demoMode, true);
    assert.equal(config.port, 8080);
    assert.equal(config.persistence, 'json');
    assert.equal(config.assignment.minConfidence, 0.8);

    const bad = [{ PORT: '99999' }, { TZ: 'Mars/Base' }, { PERSISTENCE: 'sqlite' }, { DEMO_MODE: 'maybe' }, { LOG_LEVEL: 'loud' }];
    for (const env of bad) {
      assert.throws(() => loadConfig(env), { code: 'CONFIG_ERROR' }, JSON.stringify(env));
    }
  });
});

describe('createContainer', () => {
  /** @type {string} */
  let directory;
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'retreat-container-'));
  });
  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('fails with CONFIG_ERROR without MONGODB_URI and with MAIL_SOURCE_NOT_CONFIGURED without a mail source', async () => {
    const logger = new NullLogger();
    const mailSource = { fetchChanges: async () => ({ letters: [], deletedMessageIds: [], nextCursor: 'x' }) };
    await assert.rejects(createContainer({ config: loadConfig({ PERSISTENCE: 'mongo' }), overrides: { logger, mailSource } }), {
      code: 'CONFIG_ERROR',
    });
    await assert.rejects(
      createContainer({
        config: loadConfig({
          PERSISTENCE: 'json',
          DATA_DIR: join(directory, 'data'),
          GOOGLE_CREDENTIALS_PATH: join(directory, 'missing-credentials.json'),
        }),
        overrides: { logger },
      }),
      { code: 'MAIL_SOURCE_NOT_CONFIGURED', httpStatus: 503 },
    );
  });

  it('loads participants from PARTICIPANTS_FILE with JSON persistence', async () => {
    const participantsFile = join(directory, 'participants.json');
    await writeFile(participantsFile, JSON.stringify([{ displayName: 'Ana Martín' }, { displayName: 'Juan Pérez', aliases: ['Juanito'] }]));
    const config = loadConfig({ PERSISTENCE: 'json', DATA_DIR: join(directory, 'data'), PARTICIPANTS_FILE: participantsFile });
    const container = await createContainer({
      config,
      overrides: {
        logger: new NullLogger(),
        mailSource: { fetchChanges: async () => ({ letters: [], deletedMessageIds: [], nextCursor: 'x' }) },
      },
    });
    const participants = await container.repositories.participantRepository.findAll();
    assert.deepEqual(participants.map((p) => p.id), ['ana-martin', 'juan-perez']);
    await container.close();
  });

  it('builds the Gmail mail source from credentials.json + token.json without network access', async () => {
    const credentialsPath = join(directory, 'gmail-credentials.json');
    const tokenPath = join(directory, 'gmail-token.json');
    await writeFile(credentialsPath, JSON.stringify({ installed: { client_id: 'id.apps.googleusercontent.com', client_secret: 'secret' } }));
    await writeFile(tokenPath, JSON.stringify({ refresh_token: 'r', scope: 'https://www.googleapis.com/auth/gmail.readonly' }));
    const config = loadConfig({
      PERSISTENCE: 'json',
      DATA_DIR: join(directory, 'gmail-data'),
      GOOGLE_CREDENTIALS_PATH: credentialsPath,
      GOOGLE_TOKEN_PATH: tokenPath,
      GMAIL_QUERY: 'to:cartas@example.com',
      PARTICIPANTS_FILE: join(directory, 'none.json'),
    });
    const container = await createContainer({ config, overrides: { logger: new NullLogger() } });
    assert.equal(container.mailSource.constructor.name, 'GmailMailSource');
    await container.close();
  });

  it('rejects adapters that do not implement their port', async () => {
    await assert.rejects(
      createContainer({
        config: loadConfig({ DEMO_MODE: 'true' }),
        overrides: { logger: new NullLogger(), mailSource: /** @type {any} */ ({}) },
      }),
      /MailSourcePort: adapter does not implement fetchChanges/,
    );
  });
});

describe('describeError', () => {
  it('redacts credentials and keeps AppError codes', () => {
    assert.equal(
      redactSecrets('connect failed mongodb://admin:s3cret@127.0.0.1:27017/db?password=x'),
      'connect failed mongodb://***@127.0.0.1:27017/db?password=***',
    );
    assert.equal(describeError(new AppError('SYNC_IN_PROGRESS', 409)), 'SYNC_IN_PROGRESS: Ya hay una sincronización en curso.');
    assert.match(describeError(new Error('x'.repeat(2000))), /…$/);
  });
});
