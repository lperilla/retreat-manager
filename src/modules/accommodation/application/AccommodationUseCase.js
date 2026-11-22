import { randomUUID } from 'node:crypto';

import { AppError } from '../../../domain/errors.js';
import { requireString } from '../../../application/services/validation.js';
import { getOrCreateActiveRetreat } from '../../participants/application/activeRetreat.js';
import { DIETARY_CODES, DietarySeverity } from '../../participants/domain/catalogs.js';
import { createAssignment, createRoom, createTable, roomWarnings, tableWarnings } from '../domain/accommodation.js';

/**
 * Rooms and tables of the active retreat and who is assigned to each.
 *
 * Rules: one room (and bed) and one fixed table per participant; a full room or table
 * refuses new people; only active participants can be assigned (withdrawing or deleting a
 * participant releases their place); a room or table with people cannot be deleted.
 * Warnings (snoring, accessibility) only inform, they never block.
 */
export class AccommodationUseCase {
  #rooms;
  #tables;
  #roomAssignments;
  #tableAssignments;
  #participants;
  #retreats;
  #clock;
  #logger;
  #idGenerator;

  /**
   * @param {{
   *   rooms: import('./ports.js').PlaceRepositoryPort,
   *   tables: import('./ports.js').PlaceRepositoryPort,
   *   roomAssignments: import('./ports.js').AssignmentRepositoryPort,
   *   tableAssignments: import('./ports.js').AssignmentRepositoryPort,
   *   participants: import('./ports.js').ParticipantLookupPort,
   *   retreats: import('../../participants/application/ports.js').RetreatRepositoryPort,
   *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
   *   logger: import('../../../application/ports/LoggerPort.js').LoggerPort,
   *   idGenerator?: () => string,
   * }} deps
   */
  constructor({ rooms, tables, roomAssignments, tableAssignments, participants, retreats, clock, logger, idGenerator = randomUUID }) {
    this.#rooms = rooms;
    this.#tables = tables;
    this.#roomAssignments = roomAssignments;
    this.#tableAssignments = tableAssignments;
    this.#participants = participants;
    this.#retreats = retreats;
    this.#clock = clock;
    this.#logger = logger;
    this.#idGenerator = idGenerator;
  }

  async #retreatId() {
    return (await getOrCreateActiveRetreat(this.#retreats, { now: this.#clock.now() })).id;
  }

  /**
   * Everything the screens need: rooms and tables with their occupants, warnings and the
   * dietary summary of each table, plus each participant's room and table.
   */
  async overview() {
    const retreatId = await this.#retreatId();
    const [rooms, tables, roomAssignments, tableAssignments, participants] = await Promise.all([
      this.#rooms.findByRetreat(retreatId),
      this.#tables.findByRetreat(retreatId),
      this.#roomAssignments.findByRetreat(retreatId),
      this.#tableAssignments.findByRetreat(retreatId),
      this.#participants.findByRetreat(retreatId),
    ]);
    const people = new Map(participants.map((p) => [p.id, p]));
    const occupantsOf = (/** @type {import('../domain/accommodation.js').Assignment[]} */ list, /** @type {string} */ targetId) =>
      list
        .filter((a) => a.targetId === targetId && people.has(a.participantId))
        .map((a) => ({ assignment: a, participant: /** @type {any} */ (people.get(a.participantId)) }))
        .sort((x, y) => x.participant.displayName.localeCompare(y.participant.displayName, 'es', { sensitivity: 'base' }));

    const roomViews = rooms.map((room) => {
      const occupants = occupantsOf(roomAssignments, room.id);
      return {
        ...room,
        occupancy: occupants.length,
        free: Math.max(0, room.capacity - occupants.length),
        occupants: occupants.map(({ assignment, participant }) => ({
          id: participant.id,
          displayName: participant.displayName,
          bed: assignment.bed,
          snores: participant.snores,
        })),
        warnings: roomWarnings(room, occupants.map((o) => o.participant)),
      };
    });
    const tableViews = tables.map((table) => {
      const occupants = occupantsOf(tableAssignments, table.id);
      return {
        ...table,
        occupancy: occupants.length,
        free: Math.max(0, table.capacity - occupants.length),
        occupants: occupants.map(({ participant }) => ({ id: participant.id, displayName: participant.displayName })),
        dietary: dietarySummary(occupants.map((o) => o.participant)),
        warnings: tableWarnings(table, occupants),
      };
    });

    const roomById = new Map(rooms.map((r) => [r.id, r]));
    const tableById = new Map(tables.map((t) => [t.id, t]));
    /** @type {Record<string, { room: { id: string, name: string, bed: string | null } | null, table: { id: string, name: string } | null }>} */
    const byParticipant = {};
    for (const p of participants) byParticipant[p.id] = { room: null, table: null };
    for (const a of roomAssignments) {
      const room = roomById.get(a.targetId);
      if (room && byParticipant[a.participantId]) byParticipant[a.participantId].room = { id: room.id, name: room.name, bed: a.bed };
    }
    for (const a of tableAssignments) {
      const table = tableById.get(a.targetId);
      if (table && byParticipant[a.participantId]) byParticipant[a.participantId].table = { id: table.id, name: table.name };
    }
    const active = participants.filter((p) => p.status === 'active');
    return {
      rooms: roomViews,
      tables: tableViews,
      byParticipant,
      withoutRoom: active.filter((p) => !byParticipant[p.id].room).map((p) => ({ id: p.id, displayName: p.displayName })),
      withoutTable: active.filter((p) => !byParticipant[p.id].table).map((p) => ({ id: p.id, displayName: p.displayName })),
      totals: {
        beds: rooms.reduce((sum, r) => sum + r.capacity, 0),
        seats: tables.reduce((sum, t) => sum + t.capacity, 0),
        activeParticipants: active.length,
      },
    };
  }

  /** @param {Record<string, any>} input */
  async createRoom(input) {
    const room = createRoom({ ...pick(input, ['name', 'floor', 'capacity', 'accessible', 'groundFloor', 'notes']), id: this.#idGenerator(), retreatId: await this.#retreatId() });
    await this.#assertUniqueName(this.#rooms, room, 'ROOM_NAME_TAKEN');
    await this.#rooms.save(room);
    this.#logger.info({ roomId: room.id }, 'Room created');
    return room;
  }

  /**
   * @param {string} id
   * @param {Record<string, any>} input
   */
  async updateRoom(id, input) {
    const current = await this.#requirePlace(this.#rooms, id, 'ROOM_NOT_FOUND');
    const room = createRoom({ ...current, ...pick(input, ['name', 'floor', 'capacity', 'accessible', 'groundFloor', 'notes']) });
    await this.#assertUniqueName(this.#rooms, room, 'ROOM_NAME_TAKEN');
    await this.#rooms.save(room);
    return room;
  }

  /** @param {string} id */
  async deleteRoom(id) {
    const room = await this.#requirePlace(this.#rooms, id, 'ROOM_NOT_FOUND');
    const occupied = (await this.#roomAssignments.findByRetreat(room.retreatId)).some((a) => a.targetId === room.id);
    if (occupied) throw new AppError('ROOM_NOT_EMPTY', 409);
    await this.#rooms.delete(room.id);
    return { deleted: true };
  }

  /** @param {Record<string, any>} input */
  async createTable(input) {
    const table = createTable({ ...pick(input, ['name', 'capacity', 'notes', 'leader', 'coLeader']), id: this.#idGenerator(), retreatId: await this.#retreatId() });
    await this.#assertUniqueName(this.#tables, table, 'TABLE_NAME_TAKEN');
    await this.#tables.save(table);
    this.#logger.info({ tableId: table.id }, 'Table created');
    return table;
  }

  /**
   * @param {string} id
   * @param {Record<string, any>} input
   */
  async updateTable(id, input) {
    const current = await this.#requirePlace(this.#tables, id, 'TABLE_NOT_FOUND');
    const table = createTable({ ...current, ...pick(input, ['name', 'capacity', 'notes', 'leader', 'coLeader']) });
    await this.#assertUniqueName(this.#tables, table, 'TABLE_NAME_TAKEN');
    await this.#tables.save(table);
    return table;
  }

  /** @param {string} id */
  async deleteTable(id) {
    const table = await this.#requirePlace(this.#tables, id, 'TABLE_NOT_FOUND');
    const occupied = (await this.#tableAssignments.findByRetreat(table.retreatId)).some((a) => a.targetId === table.id);
    if (occupied) throw new AppError('TABLE_NOT_EMPTY', 409);
    await this.#tables.delete(table.id);
    return { deleted: true };
  }

  /**
   * Assigns a room (and optionally a bed); `roomId: null` frees it.
   * @param {string} participantId
   * @param {{ roomId?: string | null, bed?: string | null }} input
   */
  async assignRoom(participantId, input) {
    return this.#assign({
      participantId,
      targetId: input?.roomId ?? null,
      bed: input?.bed ?? null,
      places: this.#rooms,
      assignments: this.#roomAssignments,
      notFound: 'ROOM_NOT_FOUND',
      full: 'ROOM_FULL',
    });
  }

  /**
   * Assigns the participant's fixed table; `tableId: null` frees it.
   * @param {string} participantId
   * @param {{ tableId?: string | null }} input
   */
  async assignTable(participantId, input) {
    return this.#assign({
      participantId,
      targetId: input?.tableId ?? null,
      bed: null,
      places: this.#tables,
      assignments: this.#tableAssignments,
      notFound: 'TABLE_NOT_FOUND',
      full: 'TABLE_FULL',
    });
  }

  /**
   * Frees the room and table of a participant who leaves the retreat or is deleted.
   * @param {string} participantId
   */
  async releaseParticipant(participantId) {
    const [room, table] = await Promise.all([
      this.#roomAssignments.deleteByParticipant(participantId),
      this.#tableAssignments.deleteByParticipant(participantId),
    ]);
    if (room || table) this.#logger.info({ participantId }, 'Room and table released');
  }

  /**
   * Deletes rooms, tables and assignments of a retreat (end of the retreat).
   * @param {string} retreatId
   */
  async deleteRetreatData(retreatId) {
    await Promise.all([
      this.#roomAssignments.deleteByRetreat(retreatId),
      this.#tableAssignments.deleteByRetreat(retreatId),
      this.#rooms.deleteByRetreat(retreatId),
      this.#tables.deleteByRetreat(retreatId),
    ]);
  }

  /**
   * @param {{
   *   participantId: string, targetId: string | null, bed: string | null,
   *   places: import('./ports.js').PlaceRepositoryPort, assignments: import('./ports.js').AssignmentRepositoryPort,
   *   notFound: string, full: string,
   * }} args
   */
  async #assign({ participantId, targetId, bed, places, assignments, notFound, full }) {
    const id = requireString(participantId, 'participantId', { max: 200 });
    const retreatId = await this.#retreatId();
    const participant = (await this.#participants.findByRetreat(retreatId)).find((p) => p.id === id);
    if (!participant) throw new AppError('PARTICIPANT_NOT_FOUND', 404, undefined, { participantId: id });

    if (targetId === null || targetId === '') {
      await assignments.deleteByParticipant(id);
      return this.overview();
    }
    if (participant.status !== 'active') throw new AppError('PARTICIPANT_WITHDRAWN', 409);
    const place = await this.#requirePlace(places, targetId, notFound);
    const others = (await assignments.findByRetreat(retreatId)).filter((a) => a.targetId === place.id && a.participantId !== id);
    if (others.length >= place.capacity) throw new AppError(full, 409, undefined, { capacity: place.capacity });
    await assignments.save(createAssignment({ retreatId, participantId: id, targetId: place.id, bed, assignedAt: this.#clock.now() }));
    return this.overview();
  }

  /**
   * @param {import('./ports.js').PlaceRepositoryPort} places
   * @param {unknown} idInput
   * @param {string} notFound
   */
  async #requirePlace(places, idInput, notFound) {
    const id = requireString(idInput, 'id', { max: 200 });
    const [place, retreatId] = await Promise.all([places.findById(id), this.#retreatId()]);
    if (!place || place.retreatId !== retreatId) throw new AppError(notFound, 404);
    return place;
  }

  /**
   * @param {import('./ports.js').PlaceRepositoryPort} places
   * @param {{ id: string, retreatId: string, name: string }} place
   * @param {string} code
   */
  async #assertUniqueName(places, place, code) {
    const fold = (/** @type {string} */ v) => v.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
    const clash = (await places.findByRetreat(place.retreatId)).find((p) => p.id !== place.id && fold(p.name) === fold(place.name));
    if (clash) throw new AppError(code, 409);
  }
}

/**
 * @param {Record<string, any>} input
 * @param {string[]} fields
 */
function pick(input, fields) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const field of fields) if (input && Object.hasOwn(input, field)) result[field] = input[field];
  return result;
}

/**
 * What the kitchen must know for a table: each allergy/intolerance/diet with how many people
 * have it and whether any case is severe.
 * @param {ReadonlyArray<import('../../participants/domain/ParticipantRecord.js').ParticipantRecord>} participants
 */
function dietarySummary(participants) {
  /** @type {Map<string, { type: string, code: string, label: string, count: number, severe: boolean }>} */
  const summary = new Map();
  for (const participant of participants) {
    for (const d of participant.dietary) {
      const key = `${d.type}:${d.code}:${d.code === 'other' ? d.detail ?? '' : ''}`;
      const label = d.code === 'other' ? d.detail ?? 'Otra' : /** @type {any} */ (DIETARY_CODES)[d.type]?.[d.code] ?? d.code;
      const entry = summary.get(key) ?? { type: d.type, code: d.code, label, count: 0, severe: false };
      entry.count += 1;
      entry.severe ||= d.severity === DietarySeverity.SEVERE;
      summary.set(key, entry);
    }
  }
  return [...summary.values()].sort((a, b) => Number(b.severe) - Number(a.severe) || b.count - a.count);
}
