import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AssignmentStatus } from '../../src/domain/constants.js';
import { ScriptedMailSource, buildTestContainer, makeMessage } from '../helpers/applicationFakes.js';

const COMPLETE = Object.freeze({
  age: 34,
  emergencyContacts: [{ name: 'Marta Ruiz', relationship: 'Hermana', phone: '600 111 222' }],
});

const MESSAGES = [
  makeMessage({ messageId: 'c1', subject: 'Carta para Carmen Ruiz', body: 'Querida Carmen:\nTe queremos.' }),
  makeMessage({ messageId: 'c2', subject: 'Hola', body: 'Querida Carmen:\nMucho ánimo.' }),
  makeMessage({ messageId: 'j1', subject: 'Carta para Juan', receivedAt: new Date('2026-11-18T09:00:00Z') }),
];

async function seeded(extra = {}) {
  const mailSource = new ScriptedMailSource(() => ({ letters: MESSAGES, deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true }));
  const built = await buildTestContainer({ mailSource, ...extra });
  await built.container.useCases.syncMailbox.execute();
  return built;
}

describe('ParticipantsUseCase (participants module)', () => {
  it('registers a complete participant and assigns the pending letters that name them', async () => {
    const { container } = await seeded();
    const { useCases, repositories } = container;
    assert.equal((await repositories.letterStore.findById('c1'))?.assignment.status, AssignmentStatus.NEEDS_REVIEW);

    const result = await useCases.participants.create({ givenNames: '  Carmen ', firstSurname: 'Ruiz', aliases: ['Carmencita', ''], ...COMPLETE });
    assert.equal(result.participant.id, 'carmen-ruiz');
    assert.equal(result.participant.displayName, 'Carmen Ruiz');
    assert.deepEqual(result.participant.aliases, ['Carmencita']);
    assert.equal(result.participant.complete, true);
    // "Carta para Carmen Ruiz" and "Querida Carmen:" (the only Carmen) are both assigned now.
    assert.equal(result.recompute.assignedToParticipant, 2);
    assert.deepEqual((await repositories.letterStore.findById('c2'))?.assignment.participantIds, ['carmen-ruiz']);
    assert.deepEqual((await repositories.letterStore.findById('j1'))?.assignment.participantIds, ['juan-perez']);
    // Letters see the new participant (single source).
    assert.ok(await repositories.participantRepository.findById('carmen-ruiz'));
  });

  it('requires surname, age and an emergency contact in the full form; the quick registration only the name', async () => {
    const { container } = await seeded();
    const participants = container.useCases.participants;
    await assert.rejects(participants.create({ givenNames: 'Carmen', firstSurname: 'Ruiz' }), (error) => {
      assert.equal(/** @type {any} */ (error).code, 'PARTICIPANT_INCOMPLETE');
      assert.match(/** @type {any} */ (error).message, /la edad o la fecha de nacimiento.*persona de contacto/);
      return true;
    });
    const quick = await participants.create({ givenNames: 'Carmen', firstSurname: 'Ruiz' }, { quick: true });
    assert.equal(quick.participant.complete, false);
    assert.deepEqual(quick.participant.missing, ['age', 'emergencyContact']);
    const list = await participants.list({ filter: 'incomplete' });
    assert.ok(list.participants.some((p) => p.id === 'carmen-ruiz'));
  });

  it('refuses duplicated names or aliases and invalid data with clear messages', async () => {
    const { container } = await seeded();
    const participants = container.useCases.participants;
    await assert.rejects(participants.create({ givenNames: 'juan', firstSurname: 'perez', ...COMPLETE }), { code: 'DUPLICATE_PARTICIPANT', httpStatus: 409 });
    await assert.rejects(participants.create({ givenNames: '', firstSurname: 'Ruiz', ...COMPLETE }), { code: 'INVALID_PARTICIPANT' });
    await assert.rejects(participants.create({ givenNames: 'Ana', firstSurname: 'Ruiz', email: 'no-es-correo', ...COMPLETE }), (error) => {
      assert.match(/** @type {any} */ (error).message, /^Correo electrónico:/);
      return true;
    });
    await assert.rejects(
      participants.create({ givenNames: 'Ana', firstSurname: 'Ruiz', ...COMPLETE, dietary: [{ type: 'allergy', code: 'chocolate' }] }),
      { code: 'INVALID_PARTICIPANT' },
    );
  });

  it('edits a participant (re-assigning letters when the name changes) and searches and filters the list', async () => {
    const { container } = await seeded();
    const participants = container.useCases.participants;
    await participants.create({ givenNames: 'Carmen', firstSurname: 'Ruiz', ...COMPLETE }, { quick: true });
    const updated = await participants.update('carmen-ruiz', {
      givenNames: 'Carmen',
      firstSurname: 'Ruiz',
      secondSurname: 'Gil',
      ...COMPLETE,
      snores: 'yes',
      dietary: [{ type: 'allergy', code: 'nuts', severity: 'severe' }],
      accessibilityNeeds: [{ code: 'avoid_stairs' }],
    });
    assert.equal(updated.participant.displayName, 'Carmen Ruiz Gil');
    assert.equal(updated.participant.id, 'carmen-ruiz'); // ids never change
    assert.equal(updated.participant.severeAllergy, true);

    const byFilter = async (/** @type {string} */ filter, q = '') => (await participants.list({ filter, q })).participants.map((p) => p.id);
    assert.deepEqual(await byFilter('snores'), ['carmen-ruiz']);
    assert.deepEqual(await byFilter('dietary'), ['carmen-ruiz']);
    assert.deepEqual(await byFilter('accessibility'), ['carmen-ruiz']);
    assert.deepEqual(await byFilter('all', 'ruíz gil'), ['carmen-ruiz']);
    await assert.rejects(participants.list({ filter: 'nope' }), { code: 'VALIDATION_ERROR' });
  });

  it('withdrawn participants keep their letters, marked, out of the dashboard; deleting needs no letters', async () => {
    const { container } = await seeded();
    const { useCases } = container;
    await useCases.participants.withdraw('juan-perez');

    const queue = await useCases.reviewAssignment.listQueue();
    assert.deepEqual(queue.withdrawn.letters.map((l) => l.messageId), ['j1']);
    assert.equal(queue.withdrawn.letters[0].assignment.participants[0].withdrawn, true);
    const overview = await useCases.getDashboardOverview.execute();
    assert.equal(overview.directory.rows.some((row) => row.participantId === 'juan-perez'), false);

    await assert.rejects(useCases.participants.delete('juan-perez'), { code: 'PARTICIPANT_HAS_LETTERS', httpStatus: 409 });
    await useCases.participants.reactivate('juan-perez');
    assert.ok((await useCases.getDashboardOverview.execute()).directory.rows.some((row) => row.participantId === 'juan-perez'));

    const result = await useCases.participants.delete('pedro-sanchez');
    assert.equal(result.deleted, true);
    await assert.rejects(useCases.participants.get({ id: 'pedro-sanchez' }), { code: 'PARTICIPANT_NOT_FOUND' });
  });

  it('keeps letters left "Sin asignar" reachable so they can be assigned to a new participant', async () => {
    const { container } = await seeded();
    const review = container.useCases.reviewAssignment;
    // "Carta para Carmen Ruiz": nobody called that yet → offered as a new participant.
    const before = await review.listQueue();
    assert.deepEqual(before.letters.find((l) => l.messageId === 'c1')?.detectedRecipient, { name: 'Carmen Ruiz', known: false, canCreate: true });
    // A first name alone is shown but not offered as a new participant.
    assert.equal(before.letters.find((l) => l.messageId === 'c2')?.detectedRecipient?.canCreate, false);
    await review.leaveUnassigned({ messageId: 'c2' });
    assert.deepEqual((await review.listQueue()).unassigned.letters.map((l) => l.messageId), ['c2']);

    await container.useCases.participants.create({ givenNames: 'Carmen', firstSurname: 'Ruiz' }, { quick: true });
    // The manual decision wins over recomputation: still unassigned until staff assign it.
    assert.deepEqual((await review.listQueue()).unassigned.letters.map((l) => l.messageId), ['c2']);
    const assigned = await review.assign({ messageId: 'c2', participantIds: ['carmen-ruiz'] });
    assert.equal(assigned.assignment.status, AssignmentStatus.ASSIGNED);
  });
});

describe('RetreatUseCase (automatic deletion)', () => {
  it('deletes every personal datum after the retention period and never re-imports older letters', async () => {
    const { container, clock, mailSource } = await seeded();
    const { useCases, repositories } = container;
    await useCases.participants.create({ givenNames: 'Carmen', firstSurname: 'Ruiz', ...COMPLETE });
    const before = await useCases.retreat.update({ name: 'Retiro de Emaús', startDate: '2026-11-20', endDate: '2026-11-22' });
    assert.equal(before.ended, false);
    // Last day 22/11 + 30 days → deleted from 23/12 00:00 (Madrid).
    assert.equal(before.deletionDate, '2026-12-22T23:00:00.000Z');

    assert.equal(await useCases.retreat.enforceRetention(), false);
    clock.current = new Date('2026-12-22T22:59:00Z');
    assert.equal(await useCases.retreat.enforceRetention(), false);
    clock.current = new Date('2026-12-22T23:00:00Z');
    assert.equal(await useCases.retreat.enforceRetention(), true);

    assert.equal((await repositories.letterStore.findAll({ includeDeleted: true })).length, 0);
    assert.equal((await repositories.participantRepository.findAll()).length, 0);
    const after = await useCases.retreat.get();
    assert.equal(after.name, 'Nuevo retiro');
    assert.equal(after.previous[0].name, 'Retiro de Emaús');
    assert.deepEqual(after.previous[0].summary, { participants: 7, letters: 3 });

    // The mailbox still has the old letters: a new sync must not bring them back.
    mailSource.calls.length = 0;
    await useCases.syncMailbox.execute({ mode: 'full' });
    assert.equal((await repositories.letterStore.findAll({ includeDeleted: true })).length, 0);
  });

  it('closes on request only when the retreat name is typed', async () => {
    const { container } = await seeded();
    await container.useCases.retreat.update({ name: 'Retiro de Emaús' });
    await assert.rejects(container.useCases.retreat.close({ confirmName: 'otro' }), { code: 'RETREAT_CLOSE_CONFIRMATION' });
    const result = await container.useCases.retreat.close({ confirmName: '  retiro de emaús ' });
    assert.equal(result.name, 'Nuevo retiro');
    assert.equal((await container.repositories.letterStore.findAll()).length, 0);
  });
});
