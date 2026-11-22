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
  'givenNames', 'firstSurname', 'secondSurname', 'aliases', 'birthDate', 'age', 'email', 'phone',
  'emergencyContacts', 'snores', 'dietary', 'accessibilityNeeds', 'supports', 'notes', 'attendanceConfirmed',
]);

export const PARTICIPANT_FILTERS = Object.freeze(['all', 'active', 'withdrawn', 'incomplete', 'dietary', 'accessibility', 'snores', 'confirmed', 'unconfirmed']);

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
   * }} deps  onParticipantLeft: other modules release what the participant held (room, table).
   */
  constructor({ participantRecords, retreats, letterUsage, recomputeAssignments, clock, logger, timeZone, idGenerator = randomUUID, onParticipantLeft = async () => {} }) {
    this.#records = participantRecords;
    this.#retreats = retreats;
    this.#letterUsage = letterUsage;
    this.#recompute = recomputeAssignments;
    this.#clock = clock;
    this.#logger = logger;
    this.#timeZone = timeZone;
    this.#idGenerator = idGenerator;
    this.#onParticipantLeft = onParticipantLeft;
  }

  #activeRetreat() {
    return getOrCreateActiveRetreat(this.#retreats, { now: this.#clock.now(), idGenerator: this.#idGenerator });
  }

  /**
   * @param {{ q?: string, filter?: string }} [input]
   */
  async list({ q = '', filter = 'all' } = {}) {
    if (!PARTICIPANT_FILTERS.includes(filter)) throw new AppError('VALIDATION_ERROR', 400, undefined, { field: 'filter' });
    const retreat = await this.#activeRetreat();
    const [records, counts] = await Promise.all([this.#records.findByRetreat(retreat.id), this.#letterUsage.countByParticipant()]);
    const search = fold(typeof q === 'string' ? q.slice(0, 100) : '');
    const day = retreat.startDate ?? toZonedDateKey(this.#clock.now(), this.#timeZone);
    const views = records.map((record) => this.#summary(record, counts.get(record.id) ?? 0, day));
    const matches = views.filter((view) => {
      if (search && ![view.displayName, ...view.aliases, view.phone ?? '', view.email ?? ''].some((v) => fold(v).includes(search))) return false;
      switch (filter) {
        case 'active': return view.status === ParticipantStatus.ACTIVE;
        case 'withdrawn': return view.status === ParticipantStatus.WITHDRAWN;
        case 'incomplete': return !view.complete;
        case 'dietary': return view.dietaryCount > 0;
        case 'accessibility': return view.accessibilityCount > 0;
        case 'snores': return view.snores === 'yes';
        case 'confirmed': return view.status === ParticipantStatus.ACTIVE && view.attendanceConfirmed;
        case 'unconfirmed': return view.status === ParticipantStatus.ACTIVE && !view.attendanceConfirmed;
        default: return true;
      }
    });
    return {
      retreat: { id: retreat.id, name: retreat.name },
      total: views.length,
      counts: {
        active: views.filter((v) => v.status === ParticipantStatus.ACTIVE).length,
        withdrawn: views.filter((v) => v.status === ParticipantStatus.WITHDRAWN).length,
        incomplete: views.filter((v) => !v.complete).length,
        confirmed: views.filter((v) => v.status === ParticipantStatus.ACTIVE && v.attendanceConfirmed).length,
        unconfirmed: views.filter((v) => v.status === ParticipantStatus.ACTIVE && !v.attendanceConfirmed).length,
      },
      participants: matches,
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
