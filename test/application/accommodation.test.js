import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createRoom, roomWarnings } from '../../src/modules/accommodation/domain/accommodation.js';
import { ScriptedMailSource, buildTestContainer, makeMessage } from '../helpers/applicationFakes.js';

const CONTACT = Object.freeze({ age: 30, emergencyContacts: [{ name: 'Contacto', phone: '600000000' }] });

async function setup() {
  const mailSource = new ScriptedMailSource(() => ({ letters: [makeMessage({ subject: 'Carta para Juan' })], deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true }));
  const built = await buildTestContainer({ mailSource });
  await built.container.useCases.syncMailbox.execute();
  return built;
}

describe('AccommodationUseCase (rooms and tables)', () => {
  it('assigns rooms with beds and fixed tables, refusing full places and withdrawn participants', async () => {
    const { container } = await setup();
    const { accommodation, participants } = container.useCases;
    const room = await accommodation.createRoom({ name: 'Habitación 1', capacity: 2, floor: '1ª' });
    const table = await accommodation.createTable({ name: 'Mesa 1', capacity: 1 });

    await accommodation.assignRoom('juan-perez', { roomId: room.id, bed: 'Cama 1' });
    await accommodation.assignRoom('pedro-sanchez', { roomId: room.id });
    await assert.rejects(accommodation.assignRoom('maria-garcia', { roomId: room.id }), { code: 'ROOM_FULL', httpStatus: 409 });
    // Re-assigning someone already inside does not count twice.
    await accommodation.assignRoom('juan-perez', { roomId: room.id, bed: 'Cama 2' });

    await accommodation.assignTable('juan-perez', { tableId: table.id });
    await assert.rejects(accommodation.assignTable('maria-garcia', { tableId: table.id }), { code: 'TABLE_FULL' });

    const overview = await accommodation.overview();
    assert.deepEqual(overview.byParticipant['juan-perez'], {
      room: { id: room.id, name: 'Habitación 1', bed: 'Cama 2' },
      table: { id: table.id, name: 'Mesa 1' },
    });
    assert.equal(overview.rooms[0].occupancy, 2);
    assert.equal(overview.rooms[0].free, 0);
    assert.ok(overview.withoutRoom.some((p) => p.id === 'maria-garcia'));
    assert.equal(overview.totals.beds, 2);

    // Withdrawing frees the room and table, and a withdrawn participant cannot be assigned.
    await participants.withdraw('juan-perez');
    const after = await accommodation.overview();
    assert.deepEqual(after.byParticipant['juan-perez'], { room: null, table: null });
    await assert.rejects(accommodation.assignRoom('juan-perez', { roomId: room.id }), { code: 'PARTICIPANT_WITHDRAWN' });

    // Freeing with null.
    await accommodation.assignRoom('pedro-sanchez', { roomId: null });
    assert.equal((await accommodation.overview()).rooms[0].occupancy, 0);
  });

  it('keeps names unique, refuses deleting occupied places and validates data', async () => {
    const { container } = await setup();
    const { accommodation } = container.useCases;
    const room = await accommodation.createRoom({ name: 'Habitación 10', capacity: 3 });
    await assert.rejects(accommodation.createRoom({ name: 'habitacion 10', capacity: 2 }), { code: 'ROOM_NAME_TAKEN' });
    await assert.rejects(accommodation.createRoom({ name: '', capacity: 2 }), { code: 'INVALID_ROOM' });
    await assert.rejects(accommodation.createTable({ name: 'Mesa', capacity: 0 }), { code: 'INVALID_TABLE' });
    await accommodation.createRoom({ name: 'Habitación 2', capacity: 1 });
    // Natural order: 2 before 10.
    assert.deepEqual((await accommodation.overview()).rooms.map((r) => r.name), ['Habitación 2', 'Habitación 10']);

    await accommodation.assignRoom('juan-perez', { roomId: room.id });
    await assert.rejects(accommodation.deleteRoom(room.id), { code: 'ROOM_NOT_EMPTY', httpStatus: 409 });
    const updated = await accommodation.updateRoom(room.id, { capacity: 4, accessible: true });
    assert.equal(updated.capacity, 4);
    assert.equal(updated.accessible, true);
    await accommodation.assignRoom('juan-perez', { roomId: null });
    assert.deepEqual(await accommodation.deleteRoom(room.id), { deleted: true });
    await assert.rejects(accommodation.assignRoom('nadie', { roomId: room.id }), { code: 'PARTICIPANT_NOT_FOUND' });
  });

  it('warns about snoring mixes and accessibility, and summarizes allergies per table for the kitchen', async () => {
    const { container } = await setup();
    const { accommodation, participants } = container.useCases;
    await participants.create({ givenNames: 'Ana', firstSurname: 'Ruiz', ...CONTACT, snores: 'yes', dietary: [{ type: 'allergy', code: 'nuts', severity: 'severe' }] });
    await participants.create({ givenNames: 'Eva', firstSurname: 'Gil', ...CONTACT, snores: 'no', accessibilityNeeds: [{ code: 'wheelchair' }], dietary: [{ type: 'allergy', code: 'nuts' }] });
    const room = await accommodation.createRoom({ name: 'Habitación 3', capacity: 2 });
    const table = await accommodation.createTable({ name: 'Mesa 2', capacity: 8 });
    for (const id of ['ana-ruiz', 'eva-gil']) {
      await accommodation.assignRoom(id, { roomId: room.id });
      await accommodation.assignTable(id, { tableId: table.id });
    }
    const overview = await accommodation.overview();
    const warnings = overview.rooms[0].warnings.join(' ');
    assert.match(warnings, /ronca \(Ana Ruiz\) y quien no/);
    assert.match(warnings, /Eva Gil necesita una habitación accesible/);
    assert.deepEqual(overview.tables[0].dietary, [{ type: 'allergy', code: 'nuts', label: 'Frutos de cáscara', count: 2, severe: true }]);
  });

  it('stores the table leader and co-leader (servers, not participants) and warns when missing', async () => {
    const { container } = await setup();
    const { accommodation } = container.useCases;
    const table = await accommodation.createTable({ name: 'Mesa 1', capacity: 8, leader: { name: 'Carlos Ruiz', phone: '600 111 222' }, coLeader: { name: '' } });
    assert.deepEqual(table.leader, { name: 'Carlos Ruiz', phone: '600 111 222' });
    assert.equal(table.coLeader, null);
    let overview = await accommodation.overview();
    assert.deepEqual(overview.tables[0].warnings, ['Falta el colíder de mesa.']);

    const updated = await accommodation.updateTable(table.id, { coLeader: { name: 'Pablo Gil', phone: '' } });
    assert.deepEqual(updated.coLeader, { name: 'Pablo Gil', phone: null });
    assert.deepEqual(updated.leader, { name: 'Carlos Ruiz', phone: '600 111 222' });
    overview = await accommodation.overview();
    assert.deepEqual(overview.tables[0].warnings, []);
    // Leaders are not participants: they are not offered as people to seat.
    assert.equal(overview.withoutTable.some((p) => p.displayName === 'Carlos Ruiz'), false);

    await assert.rejects(accommodation.createTable({ name: 'Mesa 2', capacity: 4, leader: { name: '', phone: '600000000' } }), { code: 'INVALID_TABLE' });
    await assert.rejects(accommodation.createTable({ name: 'Mesa 3', capacity: 4, leader: { name: 'Ana', phone: 'abc' } }), { code: 'INVALID_TABLE' });
  });

  it('is deleted with the retreat', async () => {
    const { container } = await setup();
    const { accommodation, retreat } = container.useCases;
    const room = await accommodation.createRoom({ name: 'Habitación 1', capacity: 2 });
    await accommodation.assignRoom('juan-perez', { roomId: room.id });
    await retreat.update({ name: 'Retiro' });
    await retreat.close({ confirmName: 'Retiro' });
    const overview = await accommodation.overview();
    assert.equal(overview.rooms.length, 0);
    assert.equal((await container.repositories.roomAssignments.findByParticipant('juan-perez')), null);
  });
});

describe('roomWarnings', () => {
  it('accepts ground-floor rooms for people who must avoid stairs and flags over capacity', () => {
    const room = createRoom({ id: 'r', retreatId: 'x', name: 'Baja', capacity: 1, groundFloor: true });
    const person = (/** @type {string} */ name, /** @type {string[]} */ codes) => ({ displayName: name, snores: 'unknown', accessibilityNeeds: codes.map((code) => ({ code })) });
    assert.deepEqual(roomWarnings(room, [person('Ana', ['avoid_stairs'])]), []);
    const upstairs = createRoom({ id: 'u', retreatId: 'x', name: 'Alta', capacity: 1 });
    assert.match(roomWarnings(upstairs, [person('Ana', ['avoid_stairs']), person('Eva', [])]).join(' '), /2 personas para 1 plazas.*Ana debería evitar escaleras/);
  });
});
