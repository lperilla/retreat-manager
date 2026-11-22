import { AppError } from '../../../domain/errors.js';

/**
 * Accommodation module: rooms and tables of a retreat and who is assigned to each.
 *
 * Assignments are entities of their own (not fields of the participant) so rooms and tables
 * can evolve without touching participant profiles: one room (optionally a bed) and one fixed
 * table per participant and retreat.
 *
 * @typedef {Object} Room
 * @property {string}      id
 * @property {string}      retreatId
 * @property {string}      name        "Habitación 12", "Celda San José"…
 * @property {string|null} floor       "Planta baja", "1ª"…
 * @property {number}      capacity    Beds (1-50).
 * @property {boolean}     accessible  Adapted for reduced mobility / wheelchair.
 * @property {boolean}     groundFloor No stairs needed.
 * @property {string|null} notes
 *
 * @typedef {Object} Table
 * @property {string}      id
 * @property {string}      retreatId
 * @property {string}      name        "Mesa 3"
 * @property {number}      capacity    Seats (1-50).
 * @property {TableLeader|null} leader    Table leader: a server (servidor), not a participant.
 * @property {TableLeader|null} coLeader  Co-leader: also a server.
 * @property {string|null} notes
 *
 * @typedef {{ name: string, phone: string | null }} TableLeader
 *
 * @typedef {Object} Assignment
 * @property {string}      retreatId
 * @property {string}      participantId
 * @property {string}      targetId    Room or table id.
 * @property {string|null} bed         Rooms only ("Cama 1", "Litera de arriba").
 * @property {Date}        assignedAt
 */

/**
 * @param {string} code
 * @param {string} field
 * @param {string} reason
 */
function invalid(code, field, reason) {
  return new AppError(code, 400, `${field}: ${reason}`, { field, reason });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value) {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 * @param {string} code
 * @param {string} label
 * @param {number} max
 */
function optional(value, code, label, max) {
  const text = clean(value);
  if (text.length > max) throw invalid(code, label, `máximo ${max} caracteres`);
  return text || null;
}

/**
 * @param {unknown} value
 * @param {string} code
 * @param {string} label
 * @returns {number}
 */
function capacityOf(value, code, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 50) throw invalid(code, label, 'debe ser un número entre 1 y 50');
  return number;
}

/**
 * @param {Partial<Room> & { id: string, retreatId: string }} props
 * @returns {Readonly<Room>}
 */
export function createRoom(props) {
  const name = clean(props?.name);
  if (!name) throw invalid('INVALID_ROOM', 'Nombre', 'es obligatorio');
  if (name.length > 80) throw invalid('INVALID_ROOM', 'Nombre', 'máximo 80 caracteres');
  if (!clean(props?.id) || !clean(props?.retreatId)) throw invalid('INVALID_ROOM', 'Habitación', 'faltan identificadores');
  return Object.freeze({
    id: clean(props.id),
    retreatId: clean(props.retreatId),
    name,
    floor: optional(props.floor, 'INVALID_ROOM', 'Planta', 40),
    capacity: capacityOf(props.capacity ?? 1, 'INVALID_ROOM', 'Plazas'),
    accessible: props.accessible === true,
    groundFloor: props.groundFloor === true,
    notes: optional(props.notes, 'INVALID_ROOM', 'Notas', 300),
  });
}

/**
 * @param {Partial<Table> & { id: string, retreatId: string }} props
 * @returns {Readonly<Table>}
 */
export function createTable(props) {
  const name = clean(props?.name);
  if (!name) throw invalid('INVALID_TABLE', 'Nombre', 'es obligatorio');
  if (name.length > 80) throw invalid('INVALID_TABLE', 'Nombre', 'máximo 80 caracteres');
  if (!clean(props?.id) || !clean(props?.retreatId)) throw invalid('INVALID_TABLE', 'Mesa', 'faltan identificadores');
  return Object.freeze({
    id: clean(props.id),
    retreatId: clean(props.retreatId),
    name,
    capacity: capacityOf(props.capacity ?? 1, 'INVALID_TABLE', 'Plazas'),
    leader: leaderOf(props.leader, 'Líder de mesa'),
    coLeader: leaderOf(props.coLeader, 'Colíder de mesa'),
    notes: optional(props.notes, 'INVALID_TABLE', 'Notas', 300),
  });
}

/**
 * Table leaders are servers of the retreat (not participants): just a name and, optionally,
 * a phone. An empty name means "not assigned yet".
 * @param {unknown} value
 * @param {string} label
 * @returns {Readonly<TableLeader> | null}
 */
function leaderOf(value, label) {
  const source = /** @type {{ name?: unknown, phone?: unknown } | null | undefined} */ (value);
  const name = clean(source?.name);
  const phone = clean(source?.phone);
  if (!name) {
    if (phone) throw invalid('INVALID_TABLE', label, 'falta el nombre');
    return null;
  }
  if (name.length > 120) throw invalid('INVALID_TABLE', label, 'el nombre es demasiado largo');
  if (phone && (phone.length > 40 || !/^[0-9+()\-.\s]+$/.test(phone) || phone.replace(/\D/g, '').length < 6)) {
    throw invalid('INVALID_TABLE', label, 'el teléfono no es válido');
  }
  return Object.freeze({ name, phone: phone || null });
}

/**
 * @param {Partial<Assignment> & { retreatId: string, participantId: string, targetId: string, assignedAt: Date | string }} props
 * @returns {Readonly<Assignment>}
 */
export function createAssignment(props) {
  const assignedAt = props.assignedAt instanceof Date ? props.assignedAt : new Date(props.assignedAt);
  if (!clean(props.retreatId) || !clean(props.participantId) || !clean(props.targetId) || Number.isNaN(assignedAt.getTime())) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'invalid assignment' });
  }
  return Object.freeze({
    retreatId: clean(props.retreatId),
    participantId: clean(props.participantId),
    targetId: clean(props.targetId),
    bed: optional(props.bed, 'VALIDATION_ERROR', 'Cama', 40),
    assignedAt,
  });
}

/** Accessibility needs that require an adapted room / a room without stairs. */
const NEEDS_ACCESSIBLE_ROOM = new Set(['accessible_room', 'wheelchair']);
const NEEDS_NO_STAIRS = new Set(['avoid_stairs', 'reduced_mobility', 'wheelchair']);

/**
 * Practical warnings for organizers (they never block an assignment).
 * @param {Pick<Room, 'capacity' | 'accessible' | 'groundFloor'>} room
 * @param {ReadonlyArray<{ displayName: string, snores: string, accessibilityNeeds: ReadonlyArray<{ code: string }> }>} occupants
 * @returns {string[]}
 */
export function roomWarnings(room, occupants) {
  const warnings = [];
  if (occupants.length > room.capacity) warnings.push(`Hay ${occupants.length} personas para ${room.capacity} plazas.`);
  const snorers = occupants.filter((o) => o.snores === 'yes');
  const nonSnorers = occupants.filter((o) => o.snores === 'no');
  if (snorers.length > 0 && nonSnorers.length > 0) {
    warnings.push(`Comparten habitación quien ronca (${snorers.map((o) => o.displayName).join(', ')}) y quien no.`);
  }
  for (const occupant of occupants) {
    const codes = new Set(occupant.accessibilityNeeds.map((n) => n.code));
    if (!room.accessible && [...codes].some((c) => NEEDS_ACCESSIBLE_ROOM.has(c))) {
      warnings.push(`${occupant.displayName} necesita una habitación accesible.`);
    } else if (!room.groundFloor && !room.accessible && [...codes].some((c) => NEEDS_NO_STAIRS.has(c))) {
      warnings.push(`${occupant.displayName} debería evitar escaleras (planta baja o accesible).`);
    }
  }
  return warnings;
}

/**
 * @param {Pick<Table, 'capacity' | 'leader' | 'coLeader'>} table
 * @param {ReadonlyArray<unknown>} occupants
 * @returns {string[]}
 */
export function tableWarnings(table, occupants) {
  const warnings = [];
  if (occupants.length > table.capacity) warnings.push(`Hay ${occupants.length} personas para ${table.capacity} plazas.`);
  if (!table.leader) warnings.push('Falta el líder de mesa.');
  if (!table.coLeader) warnings.push('Falta el colíder de mesa.');
  return warnings;
}
