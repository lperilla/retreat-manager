import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { loadConfig } from '../../src/composition/config.js';
import { createContainer } from '../../src/composition/container.js';
import { AssignmentStatus, FlagType } from '../../src/domain/constants.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { DemoMailSource } from '../../src/infrastructure/persistence/json/DemoMailSource.js';
import { CursorExpiredError } from '../../src/application/ports/MailSourcePort.js';
import { FakeClock } from '../helpers/applicationFakes.js';

async function demoContainer() {
  const config = loadConfig({ DEMO_MODE: 'true', SYNC_MIN_INTERVAL_SECONDS: '0', TZ: 'Europe/Madrid' });
  return createContainer({ config, overrides: { logger: new NullLogger(), clock: new FakeClock() } });
}

const ids = (refs) => refs.map((p) => p.id);

describe('demo mode', () => {
  it('wave 1 seeds the scenario described in the specification', async () => {
    const container = await demoContainer();
    const { useCases, repositories } = container;
    const result = await useCases.syncMailbox.execute();
    const { kpis } = await useCases.getDashboardOverview.execute();

    assert.equal(result.added, 23);
    assert.equal(kpis.participantCount, 18);
    assert.equal(kpis.totalLetters, 23);
    assert.equal(kpis.reviewQueueSize, 3);
    assert.deepEqual(ids(kpis.mostLetters.participants), ['lucia-fernandez', 'pablo-ortega']);
    assert.equal(kpis.mostLetters.count, 3);
    assert.deepEqual(ids(kpis.zeroLetterParticipants), ['claudia-molina', 'hugo-serrano', 'raul-dominguez']);
    assert.equal(kpis.fewestLetters.count, 0);

    const letter = (id) => repositories.letterStore.findById(id);
    assert.deepEqual((await letter('demo-w1-01'))?.assignment.participantIds, ['maria-garcia']);
    assert.equal((await letter('demo-w1-02'))?.assignment.matchedText, 'Querido Juan:');

    const ambiguous = await letter('demo-w1-03');
    assert.equal(ambiguous?.assignment.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(ambiguous?.assignment.suggestedParticipantIds, ['maria-garcia', 'maria-lopez']);

    const senderIsParticipant = await letter('demo-w1-04');
    assert.deepEqual(senderIsParticipant?.assignment.participantIds, ['pablo-ortega']);
    assert.equal(senderIsParticipant?.assignment.matches.some((m) => m.participantId === 'carmen-ruiz'), false);

    const quoted = await letter('demo-w1-05');
    assert.deepEqual(quoted?.assignment.participantIds, ['sergio-romero']);
    assert.equal(quoted?.assignment.matches.some((m) => m.participantId === 'marta-gil'), false);

    const multi = await letter('demo-w1-06');
    assert.deepEqual(multi?.assignment.participantIds, ['lucia-fernandez', 'pablo-ortega']);
    assert.ok(multi?.flags.some((f) => f.type === FlagType.MULTI_RECIPIENT));

    const autoReply = await letter('demo-w1-09');
    assert.deepEqual(autoReply?.assignment.participantIds, ['pablo-ortega']);
    assert.ok(autoReply?.flags.some((f) => f.type === FlagType.AUTO_REPLY));

    const signatureOnly = await letter('demo-w1-10');
    assert.equal(signatureOnly?.assignment.status, AssignmentStatus.NEEDS_REVIEW);
    assert.ok(signatureOnly?.flags.some((f) => f.type === FlagType.SIGNATURE_ONLY));

    const attachmentOnly = await letter('demo-w1-11');
    assert.equal(attachmentOnly?.assignment.status, AssignmentStatus.NEEDS_REVIEW);
    assert.ok(attachmentOnly?.flags.some((f) => f.type === FlagType.ATTACHMENT_ONLY));

    assert.deepEqual((await letter('demo-w1-12'))?.assignment.participantIds, ['javier-moreno']);
    assert.deepEqual((await letter('demo-w1-16'))?.assignment.participantIds, ['ana-belen-torres']);
    assert.deepEqual((await letter('demo-w1-21'))?.assignment.participantIds, ['maria-lopez']);
    assert.deepEqual((await letter('demo-w1-23'))?.assignment.participantIds, ['maria-garcia']);

    const mimeTypes = (await repositories.letterStore.findAll()).flatMap((l) => l.attachments.map((a) => a.mimeType));
    for (const mime of ['image/jpeg', 'application/pdf', 'video/quicktime']) assert.ok(mimeTypes.includes(mime));
    assert.ok(mimeTypes.some((m) => m.includes('wordprocessingml')));

    const lucia = await useCases.groupParticipantLetters.execute({ participantId: 'lucia-fernandez', afterDate: '2026-11-18' });
    assert.deepEqual(lucia.letters.map((l) => l.messageId), ['demo-w1-08']);
  });

  it('wave 2 adds 4 letters (one for a 0-letter participant) and wave 3 adds 3 and deletes 1', async () => {
    const container = await demoContainer();
    const sync = container.useCases.syncMailbox;
    await sync.execute();
    await container.useCases.markLettersSeen.execute();

    const wave2 = await sync.execute();
    assert.equal(wave2.added, 4);
    assert.ok(wave2.perParticipantDeltas.some((d) => d.participantId === 'hugo-serrano' && d.newLetters === 1));
    assert.equal((await container.useCases.getNewLetters.execute()).total, 4);

    const wave3 = await sync.execute();
    assert.equal(wave3.added, 3);
    assert.equal(wave3.deleted, 1);
    const { kpis } = await container.useCases.getDashboardOverview.execute();
    assert.equal(kpis.totalLetters, 29);
    assert.equal(kpis.reviewQueueSize, 2);
    assert.deepEqual(ids(kpis.mostLetters.participants), ['pablo-ortega']);

    const idle = await sync.execute();
    assert.equal(idle.added + idle.updated + idle.deleted, 0);

    const full = await sync.execute({ mode: 'full' });
    assert.equal(full.added, 0);
    assert.equal(full.deleted, 0);
  });

  it('reports unknown cursors as expired', async () => {
    const source = new DemoMailSource();
    await assert.rejects(source.fetchChanges('gmail-123'), CursorExpiredError);
    const full = await source.fetchChanges(null);
    assert.equal(full.isFullListing, true);
    assert.equal(full.nextCursor, 'demo:1');
  });
});
