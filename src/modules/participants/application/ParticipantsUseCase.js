import { randomUUID } from 'node:crypto';

import { slugify } from '../../../domain/entities/Participant.js';
import { AppError } from '../../../domain/errors.js';
import { toZonedDateKey } from '../../../domain/services/time.js';
import { requireString } from '../../../application/services/validation.js';
import { DietarySeverity, ParticipantStatus } from '../domain/catalogs.js';
import { MissingField, ageOn, createParticipantRecord, missingFields } from '../domain/ParticipantRecord.js';
import { getOrCreateActiveRetreat } from './activeRetreat.js';

/** Fields a participant form may send (anything else is ignored). */
const EDITABLE_FIELDS = Object.freeze([
  'givenNames', 'firstSurname', 'secondSurname', 'aliases', 'birthDate', 'age', 'nationality', 'email', 'phone',
  'emergencyContacts', 'snores', 'dietary', 'accessibilityNeeds', 'supports', 'notes', 'attendanceConfirmed', 'identityDocument',
]);

export const PARTICIPANT_FILTERS = Object.freeze(['all', 'active', 'withdrawn', 'incomplete', 'dietary', 'accessibility', 'snores', 'confirmed', 'unconfirmed', 'noRoom', 'noTable']);
export const PARTICIPANT_SORTS = Object.freeze(['name', 'attendance', 'age', 'room', 'table', 'letters']);

/** Human description of each filter (export "Información" sheet). */
export const FILTER_LABELS = Object.freeze({
  all: 'Todos',
  active: 'Activos',
  withdrawn: 'Dados de baja',
  incomplete: 'Fichas incompletas',
  dietary: 'Con alergias, intolerancias o dieta',
  accessibility: 'Con necesidades de accesibilidad',
  snores: 'Roncan',
  confirmed: 'Asistencia confirmada',
  unconfirmed: 'Asistencia sin confirmar',
  noRoom: 'Sin habitación',
  noTable: 'Sin mesa',
});
export const SORT_LABELS = Object.freeze({ name: 'Nombre', attendance: 'Asistencia', age: 'Edad', room: 'Habitación', table: 'Mesa', letters: 'Cartas' });

/**
 * @param {string} value
 * @returns {string}
 */
function fold(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {Record<string, any>} input
 * @returns {Record<string, any>}
 */
function pickEditable(input) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const field of EDITABLE_FIELDS) if (input && Object.hasOwn(input, field)) result[field] = input[field];
  return result;
}

/**
 * Participants of the retreat: list, detail, registration (full or quick), edition,
 * withdrawal and deletion. Every change that affects names re-runs the letter assignment
 * (manual decisions are never touched).
 */
export class ParticipantsUseCase {
  #records;
  #retreats;
  #letterUsage;
  #recompute;
  #clock;
  #logger;
  #idGenerator;
  #timeZone;
  #onParticipantLeft;
  #placements;

  /**
   * @param {{
   *   participantRecords: import('./ports.js').ParticipantRecordRepositoryPort,
   *   retreats: import('./ports.js').RetreatRepositoryPort,
   *   letterUsage: { countByParticipant: () => Promise<Map<string, number>> },
   *   recomputeAssignments: { execute: () => Promise<any> },
   *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
   *   logger: import('../../../application/ports/LoggerPort.js').LoggerPort,
   *   timeZone: string,
   *   idGenerator?: () => string,
   *   onParticipantLeft?: (participantId: string) => Promise<void>,
   *   placements?: { byParticipant: () => Promise<Record<string, { room: { id: string, name: string, bed: string | null } | null, table: { id: string, name: string } | null }>> },
   * }} deps  placements: room and table of each participant (accommodation module).  onParticipantLeft: other modules release what the participant held (room, table).
   */
  constructor({ participantRecords, retreats, letterUsage, recomputeAssignments, clock, logger, timeZone, idGenerator = randomUUID, onParticipantLeft = async () => {}, placements = { byParticipant: async () => ({}) } }) {
    this.#records = participantRecords;
    this.#retreats = retreats;
    this.#letterUsage = letterUsage;
    this.#recompute = recomputeAssignments;
    this.#clock = clock;
    this.#logger = logger;
    this.#timeZone = timeZone;
    this.#idGenerator = idGenerator;
    this.#onParticipantLeft = onParticipantLeft;
    this.#placements = placements;
  }

  #activeRetreat() {
    return getOrCreateActiveRetreat(this.#retreats, { now: this.#clock.now(), idGenerator: this.#idGenerator });
  }

  /**
   * @typedef {{ q?: string, filter?: string, tableId?: string, sort?: string, dir?: string }} ListQuery
   *   tableId: a table id, "none" (without table) or empty (all); dir: "asc" | "desc".
   */

  /**
   * Search, filter (also by table) and sort the participants of the active retreat.
   * @param {ListQuery} [input]
   */
  async #query({ q = '', filter = 'all', tableId = '', sort = 'name', dir = 'asc' } = {}) {
    if (!PARTICIPANT_FILTERS.includes(filter)) throw new AppError('VALIDATION_ERROR', 400, undefined, { field: 'filter' });
    if (!PARTICIPANT_SORTS.includes(sort)) throw new AppError('VALIDATION_ERROR', 400, undefined, { field: 'sort' });
    if (dir !== 'asc' && dir !== 'desc') throw new AppError('VALIDATION_ERROR', 400, undefined, { field: 'dir' });
    const retreat = await this.#activeRetreat();
    const [records, counts, places] = await Promise.all([
      this.#records.findByRetreat(retreat.id),
      this.#letterUsage.countByParticipant(),
      this.#placements.byParticipant(),
    ]);
    const search = fold(typeof q === 'string' ? q.slice(0, 100) : '');
    const day = retreat.startDate ?? toZonedDateKey(this.#clock.now(), this.#timeZone);
    const byId = new Map(records.map((r) => [r.id, r]));
    const views = records.map((record) => ({
      ...this.#summary(record, counts.get(record.id) ?? 0, day),
      room: places[record.id]?.room ?? null,
      table: places[record.id]?.table ?? null,
    }));
    const active = (/** @type {any} */ v) => v.status === ParticipantStatus.ACTIVE;
    const matches = views.filter((view) => {
      const documentNumber = byId.get(view.id)?.identityDocument?.number ?? '';
      if (search && ![view.displayName, ...view.aliases, view.phone ?? '', view.email ?? '', view.nationality ?? '', documentNumber].some((v) => fold(v).includes(search))) return false;
      if (tableId === 'none' && view.table) return false;
      if (tableId && tableId !== 'none' && view.table?.id !== tableId) return false;
      switch (filter) {
        case 'active': return active(view);
        case 'withdrawn': return view.status === ParticipantStatus.WITHDRAWN;
        case 'incomplete': return !view.complete;
        case 'dietary': return view.dietaryCount > 0;
        case 'accessibility': return view.accessibilityCount > 0;
        case 'snores': return view.snores === 'yes';
        case 'confirmed': return active(view) && view.attendanceConfirmed;
        case 'unconfirmed': return active(view) && !view.attendanceConfirmed;
        case 'noRoom': return active(view) && !view.room;
        case 'noTable': return active(view) && !view.table;
        default: return true;
      }
    });
    const text = (/** @type {string | null | undefined} */ a, /** @type {string | null | undefined} */ b) => {
      // Empty values always last, whatever the direction.
      if (!a && !b) return 0;
      if (!a) return Number.POSITIVE_INFINITY;
      if (!b) return Number.NEGATIVE_INFINITY;
      return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
    };
    const byName = (/** @type {any} */ a, /** @type {any} */ b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' });
    /** @type {Record<string, (a: any, b: any) => number>} */
    const comparators = {
      name: byName,
      attendance: (a, b) => Number(b.attendanceConfirmed) - Number(a.attendanceConfirmed),
      age: (a, b) => (a.age === null && b.age === null ? 0 : a.age === null ? Number.POSITIVE_INFINITY : b.age === null ? Number.NEGATIVE_INFINITY : a.age - b.age),
      room: (a, b) => text(a.room?.name, b.room?.name),
      table: (a, b) => text(a.table?.name, b.table?.name),
      letters: (a, b) => a.letterCount - b.letterCount,
    };
    const sign = dir === 'desc' ? -1 : 1;
    matches.sort((a, b) => {
      const result = comparators[sort](a, b);
      if (!Number.isFinite(result)) return result > 0 ? 1 : -1; // empty values last in both directions
      return sign * result || byName(a, b);
    });
    return {
      retreat,
      byId,
      views,
      matches,
      counts: {
        active: views.filter(active).length,
        withdrawn: views.filter((v) => v.status === ParticipantStatus.WITHDRAWN).length,
        incomplete: views.filter((v) => !v.complete).length,
        confirmed: views.filter((v) => active(v) && v.attendanceConfirmed).length,
        unconfirmed: views.filter((v) => active(v) && !v.attendanceConfirmed).length,
        noRoom: views.filter((v) => active(v) && !v.room).length,
        noTable: views.filter((v) => active(v) && !v.table).length,
      },
    };
  }

  /**
   * @param {ListQuery} [input]
   */
  async list(input = {}) {
    const { retreat, views, matches, counts } = await this.#query(input);
    return { retreat: { id: retreat.id, name: retreat.name }, total: views.length, counts, participants: matches };
  }

  /**
   * Everything the Excel export needs for the participants of the current view (same
   * search, filter, table and order as the screen). The identity document is left out.
   * @param {ListQuery} [input]
   */
  async exportData(input = {}) {
    const { retreat, byId, views, matches } = await this.#query(input);
    return {
      retreat: { name: retreat.name, startDate: retreat.startDate, endDate: retreat.endDate },
      generatedAt: this.#clock.now(),
      total: views.length,
      criteria: {
        q: typeof input.q === 'string' ? input.q.trim() : '',
        filter: FILTER_LABELS[/** @type {keyof typeof FILTER_LABELS} */ (input.filter ?? 'all')] ?? 'Todos',
        table: input.tableId === 'none' ? 'Sin mesa' : input.tableId ? matches[0]?.table?.name ?? input.tableId : 'Todas',
        sort: `${SORT_LABELS[/** @type {keyof typeof SORT_LABELS} */ (input.sort ?? 'name')] ?? 'Nombre'} (${input.dir === 'desc' ? 'descendente' : 'ascendente'})`,
      },
      rows: matches.map((view) => {
        const record = /** @type {import('../domain/ParticipantRecord.js').ParticipantRecord} */ (byId.get(view.id));
        return {
          view,
          record: {
            givenNames: record.givenNames,
            firstSurname: record.firstSurname,
            secondSurname: record.secondSurname,
            aliases: [...record.aliases],
            birthDate: record.birthDate,
            nationality: record.nationality,
            email: record.email,
            phone: record.phone,
            emergencyContacts: record.emergencyContacts.map((c) => ({ ...c })),
            dietary: record.dietary.map((d) => ({ ...d })),
            accessibilityNeeds: record.accessibilityNeeds.map((n) => ({ ...n })),
            supports: record.supports,
            notes: record.notes,
            attendanceConfirmedAt: record.attendanceConfirmedAt,
          },
        };
      }),
    };
  }

  /** @param {{ id: string }} input */
  async get({ id }) {
    const record = await this.#require(id);
    const retreat = await this.#activeRetreat();
    const counts = await this.#letterUsage.countByParticipant();
    const day = retreat.startDate ?? toZonedDateKey(this.#clock.now(), this.#timeZone);
    return this.#detail(record, counts.get(record.id) ?? 0, day);
  }

  /**
   * Registers a participant. The full form requires a complete profile; the quick
   * registration from the letters screen only needs the name and is reported as incomplete.
   * @param {Record<string, any>} input
   * @param {{ quick?: boolean }} [options]
   */
  async create(input, { quick = false } = {}) {
    const retreat = await this.#activeRetreat();
    const now = this.#clock.now();
    const data = pickEditable(input);
    const draft = createParticipantRecord({ ...data, id: 'draft', retreatId: retreat.id, createdAt: now });
    if (!quick) assertComplete(draft);
    const existing = await this.#records.findByRetreat(retreat.id);
    assertNoNameClash(draft, existing);

    const base = slugify(draft.displayName) || 'participante';
    let id = base;
    for (let n = 2; (await this.#records.findById(id)) !== null; n += 1) id = `${base}-${n}`;
    const record = createParticipantRecord({ ...draft, id, createdAt: now, updatedAt: now, attendanceConfirmedAt: draft.attendanceConfirmed ? now : null });
    await this.#records.save(record);
    this.#logger.info({ participantId: record.id, quick }, 'Participant registered');
    return this.#afterNamesChanged(record);
  }

  /**
   * @param {string} id
   * @param {Record<string, any>} input
   */
  async update(id, input) {
    const current = await this.#require(id);
    const now = this.#clock.now();
    const data = pickEditable(input);
    // Saving the form means a person has checked the name (old single-field names).
    const confirmed = data.attendanceConfirmed === undefined ? current.attendanceConfirmed : data.attendanceConfirmed === true;
    const record = createParticipantRecord({
      ...current,
      ...data,
      id: current.id,
      nameNeedsReview: false,
      attendanceConfirmed: confirmed,
      attendanceConfirmedAt: confirmed ? (current.attendanceConfirmed ? current.attendanceConfirmedAt : now) : null,
      updatedAt: now,
    });
    assertComplete(record);
    const others = (await this.#records.findByRetreat(current.retreatId)).filter((r) => r.id !== current.id);
    assertNoNameClash(record, others);
    await this.#records.save(record);
    this.#logger.info({ participantId: record.id }, 'Participant updated');
    const namesChanged = record.displayName !== current.displayName || record.aliases.join('|') !== current.aliases.join('|') || current.nameNeedsReview;
    if (namesChanged) return this.#afterNamesChanged(record);
    return { participant: await this.get({ id: record.id }), recompute: null };
  }

  /**
   * "Dar de baja": the participant leaves the retreat. Letters stay with them, marked as
   * "no está en el retiro", and they disappear from the dashboard and print batches. Their
   * room and table are released.
   * @param {string} id
   */
  async withdraw(id) {
    const current = await this.#require(id);
    if (current.status === ParticipantStatus.WITHDRAWN) return { participant: await this.get({ id }) };
    const now = this.#clock.now();
    await this.#records.save(createParticipantRecord({ ...current, status: ParticipantStatus.WITHDRAWN, withdrawnAt: now, updatedAt: now }));
    this.#logger.info({ participantId: id }, 'Participant withdrawn');
    await this.#onParticipantLeft(id);
    return { participant: await this.get({ id }) };
  }

  /**
   * Confirms (or un-confirms) that the participant will attend the retreat.
   * @param {string} id
   * @param {{ confirmed: boolean }} input
   */
  async setAttendance(id, input) {
    const current = await this.#require(id);
    if (typeof input?.confirmed !== 'boolean') throw new AppError('VALIDATION_ERROR', 400, undefined, { field: 'confirmed' });
    if (current.status === ParticipantStatus.WITHDRAWN && input.confirmed) throw new AppError('PARTICIPANT_WITHDRAWN', 409);
    const now = this.#clock.now();
    await this.#records.save(
      createParticipantRecord({
        ...current,
        attendanceConfirmed: input.confirmed,
        attendanceConfirmedAt: input.confirmed ? (current.attendanceConfirmed ? current.attendanceConfirmedAt : now) : null,
        updatedAt: now,
      }),
    );
    this.#logger.info({ participantId: id, confirmed: input.confirmed }, 'Participant attendance updated');
    return { participant: await this.get({ id }) };
  }

  /** @param {string} id */
  async reactivate(id) {
    const current = await this.#require(id);
    const now = this.#clock.now();
    await this.#records.save(createParticipantRecord({ ...current, status: ParticipantStatus.ACTIVE, withdrawnAt: null, updatedAt: now }));
    this.#logger.info({ participantId: id }, 'Participant reactivated');
    return { participant: await this.get({ id }) };
  }

  /**
   * Deleting is only possible while no letter is assigned to the participant (otherwise the
   * letters would be left pointing to nobody): withdraw them instead.
   * @param {string} id
   */
  async delete(id) {
    const current = await this.#require(id);
    const letters = (await this.#letterUsage.countByParticipant()).get(current.id) ?? 0;
    if (letters > 0) throw new AppError('PARTICIPANT_HAS_LETTERS', 409, undefined, { participantId: id, letters });
    await this.#records.delete(current.id);
    this.#logger.info({ participantId: id }, 'Participant deleted');
    await this.#onParticipantLeft(current.id);
    const recompute = await this.#recompute.execute();
    return { deleted: true, recompute: { changed: recompute.changed } };
  }

  /** @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record */
  async #afterNamesChanged(record) {
    const recompute = await this.#recompute.execute();
    return {
      participant: await this.get({ id: record.id }),
      recompute: {
        changed: recompute.changed,
        assignedToParticipant: recompute.changes.filter((/** @type {any} */ change) =>
          (change.after?.participants ?? []).some((/** @type {any} */ p) => p.id === record.id),
        ).length,
      },
    };
  }

  /** @param {unknown} idInput */
  async #require(idInput) {
    const id = requireString(idInput, 'id', { max: 200 });
    const retreat = await this.#activeRetreat();
    const record = await this.#records.findById(id);
    if (!record || record.retreatId !== retreat.id) throw new AppError('PARTICIPANT_NOT_FOUND', 404, undefined, { participantId: id });
    return record;
  }

  /**
   * @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record
   * @param {number} letterCount
   * @param {string} day
   */
  #summary(record, letterCount, day) {
    const missing = missingFields(record);
    const contact = record.emergencyContacts[0] ?? null;
    return {
      id: record.id,
      displayName: record.displayName,
      givenNames: record.givenNames,
      firstSurname: record.firstSurname,
      secondSurname: record.secondSurname,
      aliases: [...record.aliases],
      age: ageOn(record, day),
      nationality: record.nationality,
      phone: record.phone,
      email: record.email,
      emergencyContact: contact ? { name: contact.name, phone: contact.phone } : null,
      snores: record.snores,
      dietaryCount: record.dietary.length,
      severeAllergy: record.dietary.some((d) => d.severity === DietarySeverity.SEVERE),
      accessibilityCount: record.accessibilityNeeds.length,
      status: record.status,
      attendanceConfirmed: record.attendanceConfirmed,
      attendanceConfirmedAt: record.attendanceConfirmedAt?.toISOString() ?? null,
      missing,
      complete: missing.length === 0,
      letterCount,
    };
  }

  /**
   * @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record
   * @param {number} letterCount
   * @param {string} day
   */
  #detail(record, letterCount, day) {
    return {
      ...this.#summary(record, letterCount, day),
      birthDate: record.birthDate,
      ageInput: record.age,
      emergencyContacts: record.emergencyContacts.map((c) => ({ ...c })),
      identityDocument: record.identityDocument ? { ...record.identityDocument } : null,
      dietary: record.dietary.map((d) => ({ ...d })),
      accessibilityNeeds: record.accessibilityNeeds.map((n) => ({ ...n })),
      supports: record.supports,
      notes: record.notes,
      nameNeedsReview: record.nameNeedsReview,
      withdrawnAt: record.withdrawnAt?.toISOString() ?? null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

/** Spanish explanation of what is missing in a profile. */
export const MISSING_LABELS = Object.freeze({
  [MissingField.FIRST_SURNAME]: 'el primer apellido',
  [MissingField.AGE]: 'la edad o la fecha de nacimiento',
  [MissingField.EMERGENCY_CONTACT]: 'una persona de contacto para emergencias (nombre y teléfono)',
  [MissingField.NAME_REVIEW]: 'revisar cómo se reparten nombre y apellidos',
});

/**
 * The full form requires surname, age and an emergency contact.
 * @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record
 */
function assertComplete(record) {
  const missing = missingFields({ ...record, nameNeedsReview: false });
  if (missing.length === 0) return;
  const labels = missing.map((field) => MISSING_LABELS[/** @type {keyof typeof MISSING_LABELS} */ (field)]);
  throw new AppError('PARTICIPANT_INCOMPLETE', 400, `Falta ${labels.join(', ')}.`, { missing });
}

/**
 * Two participants may not share a name or an alias (letters could not tell them apart).
 * @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record
 * @param {readonly import('../domain/ParticipantRecord.js').ParticipantRecord[]} others
 */
function assertNoNameClash(record, others) {
  const doc = record.identityDocument;
  const sameDocument = doc ? others.find((o) => o.identityDocument?.type === doc.type && o.identityDocument.number === doc.number) : null;
  if (sameDocument) {
    throw new AppError('DUPLICATE_DOCUMENT', 409, `Ese documento ya está registrado para ${sameDocument.displayName}.`, { participantId: sameDocument.id });
  }
  const taken = new Map();
  for (const other of others) for (const name of [other.displayName, ...other.aliases]) taken.set(slugify(name), other);
  for (const name of [record.displayName, ...record.aliases]) {
    const clash = taken.get(slugify(name));
    if (clash) {
      throw new AppError('DUPLICATE_PARTICIPANT', 409, `Ya existe un participante con ese nombre o apodo: ${clash.displayName}.`, {
        participantId: clash.id,
      });
    }
  }
}
