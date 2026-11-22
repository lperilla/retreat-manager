import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { AssignmentStatus } from '../../src/domain/constants.js';
import { readParticipantsFile, writeParticipantsFile } from '../../src/infrastructure/persistence/json/participantsFile.js';
import { ScriptedMailSource, buildTestContainer, makeMessage } from '../helpers/applicationFakes.js';

const MESSAGES = [
  makeMessage({ messageId: 'c1', subject: 'Carta para Carmen Ruiz', body: 'Querida Carmen:\nTe queremos.' }),
  makeMessage({ messageId: 'c2', subject: 'Hola', body: 'Querida Carmen:\nMucho ánimo.' }),
  makeMessage({ messageId: 'j1', subject: 'Carta para Juan', receivedAt: new Date('2026-11-18T09:00:00Z') }),
];

/** Records what would be written to PARTICIPANTS_FILE. */
class RecordingParticipantFile {
  /** @type {any[][]} */
  writes = [];

  /** @param {any[]} participants */
  async write(participants) {
    this.writes.push(participants.map((p) => p.id));
  }
}

async function seeded() {
  const participantFile = new RecordingParticipantFile();
  const mailSource = new ScriptedMailSource(() => ({ letters: MESSAGES, deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true }));
  const { container } = await buildTestContainer({ mailSource, overrides: { participantFile } });
  await container.useCases.syncMailbox.execute();
  return { container, participantFile };
}

describe('AddParticipantUseCase', () => {
  it('adds a missing participant, saves the list and assigns the pending letters that name them', async () => {
    const { container, participantFile } = await seeded();
    const { useCases, repositories } = container;
    assert.equal((await repositories.letterStore.findById('c1'))?.assignment.status, AssignmentStatus.NEEDS_REVIEW);

    const result = await useCases.addParticipant.execute({ displayName: '  Carmen   Ruiz ', aliases: ['Carmencita', ''] });
    assert.deepEqual(result.participant, { id: 'carmen-ruiz', displayName: 'Carmen Ruiz', aliases: ['Carmencita'] });
    assert.equal(result.savedToFile, true);
    // "Carta para Carmen Ruiz" and "Querida Carmen:" (the only Carmen) are both assigned now.
    assert.equal(result.recompute.assignedToNew, 2);
    assert.ok(participantFile.writes[0].includes('carmen-ruiz'));
    assert.ok(await repositories.participantRepository.findById('carmen-ruiz'));
    assert.deepEqual((await repositories.letterStore.findById('c1'))?.assignment.participantIds, ['carmen-ruiz']);
    assert.deepEqual((await repositories.letterStore.findById('c2'))?.assignment.participantIds, ['carmen-ruiz']);
    assert.deepEqual((await repositories.letterStore.findById('j1'))?.assignment.participantIds, ['juan-perez']);
  });

  it('refuses duplicates by name or alias (accent and case-insensitive) and invalid input', async () => {
    const { container } = await seeded();
    const add = container.useCases.addParticipant;
    await assert.rejects(add.execute({ displayName: 'juan perez' }), { code: 'DUPLICATE_PARTICIPANT', httpStatus: 409 });
    await assert.rejects(add.execute({ displayName: '' }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(add.execute({ displayName: '¿¿??' }), { code: 'INVALID_PARTICIPANT' });
    await assert.rejects(add.execute({ displayName: 'Ana Ruiz', aliases: 'Ana' }), { code: 'INVALID_PARTICIPANT' });
  });

  it('keeps letters left "Sin asignar" reachable so they can be assigned to the new participant', async () => {
    const { container } = await seeded();
    const review = container.useCases.reviewAssignment;
    await review.leaveUnassigned({ messageId: 'c2' });

    let queue = await review.listQueue();
    assert.deepEqual(queue.unassigned.letters.map((l) => l.messageId), ['c2']);
    assert.equal(queue.unassigned.total, 1);

    await container.useCases.addParticipant.execute({ displayName: 'Carmen Ruiz' });
    // The manual decision wins over recomputation: still unassigned until staff assign it.
    queue = await review.listQueue();
    assert.deepEqual(queue.unassigned.letters.map((l) => l.messageId), ['c2']);

    const assigned = await review.assign({ messageId: 'c2', participantIds: ['carmen-ruiz'] });
    assert.equal(assigned.assignment.status, AssignmentStatus.ASSIGNED);
    assert.equal((await review.listQueue()).unassigned.total, 0);
  });
});

describe('participants file', () => {
  /** @type {string} */
  let dir;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'participants-'));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes the list back in the hand-written shape and keeps a backup of the previous file', async () => {
    const file = join(dir, 'participants.json');
    await writeFile(file, JSON.stringify([{ displayName: 'María García', aliases: ['Mari'] }]), 'utf8');
    const list = await readParticipantsFile(file);
    await writeParticipantsFile(file, [
      ...(list ?? []),
      { id: 'luis-perilla', displayName: 'Luis Perilla', aliases: [] },
      { id: 'juan-perez-2', displayName: 'Juan Pérez', aliases: ['Juanito'] },
    ]);

    const written = JSON.parse(await readFile(file, 'utf8'));
    assert.deepEqual(written, [
      { displayName: 'María García', aliases: ['Mari'] },
      { displayName: 'Luis Perilla', aliases: [] },
      { id: 'juan-perez-2', displayName: 'Juan Pérez', aliases: ['Juanito'] },
    ]);
    assert.deepEqual(JSON.parse(await readFile(`${file}.bak`, 'utf8')), [{ displayName: 'María García', aliases: ['Mari'] }]);
    assert.deepEqual((await readParticipantsFile(file))?.map((p) => p.id), ['maria-garcia', 'luis-perilla', 'juan-perez-2']);
  });
});
