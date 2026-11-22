import { AppError } from '../../../domain/errors.js';
import { optionalDateOnly } from './Retreat.js';
import {
  ACCESSIBILITY_NEEDS,
  DIETARY_CODES,
  DietarySeverity,
  DietaryType,
  ParticipantStatus,
  Snoring,
} from './catalogs.js';

/**
 * Participant of a retreat: the single source of participants for every module (letters
 * today; rooms, tables, kitchen and accessibility planning later).
 *
 * Personal data is limited to what organizers need. Allergies and accessibility needs are
 * PRACTICAL catalog entries (what is needed), never diagnoses. Room and table assignments
 * live in their own entities (phase B), not here.
 *
 * @typedef {{ name: string, relationship: string | null, phone: string }} EmergencyContact
 * @typedef {{ type: string, code: string, severity: string | null, detail: string | null }} DietaryRestriction
 * @typedef {{ code: string, detail: string | null }} AccessibilityNeed
 *
 * @typedef {Object} ParticipantRecord
 * @property {string}   id               Stable slug chosen at creation (never recomputed on rename).
 * @property {string}   retreatId
 * @property {string}   givenNames       "José Antonio" (required).
 * @property {string}   firstSurname     Required for a complete profile ("de la Fuente" allowed).
 * @property {string|null} secondSurname
 * @property {string}   displayName      Derived: given names + surnames.
 * @property {string[]} aliases          Nicknames / other names used in letters ("Pepe").
 * @property {string|null} birthDate     YYYY-MM-DD.
 * @property {number|null} age           When the birth date is unknown.
 * @property {string|null} email         Optional; never used to deliver letters.
 * @property {string|null} phone         Participant's own phone (optional).
 * @property {EmergencyContact[]} emergencyContacts  1-2 required for a complete profile.
 * @property {string}   snores           Snoring.*
 * @property {DietaryRestriction[]} dietary
 * @property {AccessibilityNeed[]} accessibilityNeeds
 * @property {string|null} supports      Practical support needed during the retreat.
 * @property {string|null} notes         Observations for the stay (no diagnoses).
 * @property {string}   status           ParticipantStatus.*
 * @property {Date|null} withdrawnAt
 * @property {boolean}  nameNeedsReview  Name split automatically from an old single-field name.
 * @property {Date}     createdAt
 * @property {Date}     updatedAt
 */

const MAX = Object.freeze({ name: 80, alias: 80, aliases: 20, email: 200, phone: 40, contactName: 120, relationship: 60, detail: 300, supports: 1000, notes: 2000, dietary: 30, needs: 20 });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[0-9+()\-.\s]+$/;
/** Words that belong to the following surname ("de la Fuente", "del Río", "San Juan"). */
const SURNAME_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'san', 'santa', 'da', 'do', 'dos', 'van', 'von']);

/**
 * @param {string} field
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(field, reason) {
  return new AppError('INVALID_PARTICIPANT', 400, `${FIELD_LABELS[field] ?? 'Dato'}: ${reason}`, { field, reason });
}

/** Spanish field names for validation messages. */
export const FIELD_LABELS = Object.freeze({
  id: 'Identificador',
  retreatId: 'Retiro',
  givenNames: 'Nombre',
  firstSurname: 'Primer apellido',
  secondSurname: 'Segundo apellido',
  aliases: 'Apodos',
  birthDate: 'Fecha de nacimiento',
  age: 'Edad',
  email: 'Correo electrónico',
  phone: 'Teléfono',
  emergencyContacts: 'Contacto de emergencia',
  snores: 'Ronca',
  dietary: 'Alimentación',
  accessibilityNeeds: 'Accesibilidad',
  supports: 'Apoyos',
  notes: 'Observaciones',
  status: 'Estado',
});

/**
 * @param {unknown} value
 * @returns {string}
 */
function clean(value) {
  return value === undefined || value === null ? '' : String(value).replace(/\s+/g, ' ').trim();
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {number} max
 * @returns {string | null}
 */
function optionalText(value, field, max) {
  const text = value === undefined || value === null ? '' : String(value).replace(/\r\n?/g, '\n').trim();
  if (!text) return null;
  if (text.length > max) throw invalid(field, `máximo ${max} caracteres`);
  return text;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | null}
 */
function optionalPhone(value, field) {
  const text = clean(value);
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  if (text.length > MAX.phone || !PHONE_CHARS.test(text) || digits.length < 6) throw invalid(field, 'no es un teléfono válido');
  return text;
}

/**
 * @param {string} value
 * @returns {string}
 */
function fold(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '');
}

/**
 * Splits an old single-field name ("José Antonio García López") into given names and
 * surnames. Two words are unambiguous; with three or more the split is a guess (a compound
 * given name is indistinguishable from two surnames), so the result is flagged for review.
 * Surname particles stay with their surname ("María de la Fuente").
 * @param {string} fullName
 * @returns {{ givenNames: string, firstSurname: string, secondSurname: string | null, needsReview: boolean }}
 */
export function splitFullName(fullName) {
  const words = clean(fullName).split(' ').filter(Boolean);
  /** @type {string[]} */
  const groups = [];
  for (let i = 0; i < words.length; i += 1) {
    if (i > 0 && SURNAME_PARTICLES.has(fold(words[i])) && i < words.length - 1) {
      let group = words[i];
      while (i + 1 < words.length - 1 && SURNAME_PARTICLES.has(fold(words[i + 1]))) group += ` ${words[(i += 1)]}`;
      group += ` ${words[(i += 1)]}`;
      groups.push(group);
    } else {
      groups.push(words[i]);
    }
  }
  if (groups.length === 0) return { givenNames: '', firstSurname: '', secondSurname: null, needsReview: true };
  if (groups.length === 1) return { givenNames: groups[0], firstSurname: '', secondSurname: null, needsReview: true };
  if (groups.length === 2) return { givenNames: groups[0], firstSurname: groups[1], secondSurname: null, needsReview: false };
  if (groups.length === 3) return { givenNames: groups[0], firstSurname: groups[1], secondSurname: groups[2], needsReview: true };
  return {
    givenNames: groups.slice(0, groups.length - 2).join(' '),
    firstSurname: groups[groups.length - 2],
    secondSurname: groups[groups.length - 1],
    needsReview: true,
  };
}

/**
 * @param {{ givenNames: string, firstSurname?: string | null, secondSurname?: string | null }} parts
 * @returns {string}
 */
export function buildDisplayName({ givenNames, firstSurname, secondSurname }) {
  return [givenNames, firstSurname, secondSurname].map(clean).filter(Boolean).join(' ');
}

/**
 * @param {unknown} list
 * @returns {EmergencyContact[]}
 */
function emergencyContacts(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw invalid('emergencyContacts', 'debe ser una lista');
  const result = [];
  for (const item of list) {
    const name = clean(item?.name);
    const phone = optionalPhone(item?.phone, 'emergencyContacts');
    const relationship = clean(item?.relationship) || null;
    if (!name && !phone && !relationship) continue;
    if (!name) throw invalid('emergencyContacts', 'falta el nombre de la persona de contacto');
    if (!phone) throw invalid('emergencyContacts', 'falta el teléfono de la persona de contacto');
    if (name.length > MAX.contactName) throw invalid('emergencyContacts', 'el nombre es demasiado largo');
    if (relationship && relationship.length > MAX.relationship) throw invalid('emergencyContacts', 'el parentesco es demasiado largo');
    result.push(Object.freeze({ name, relationship, phone }));
  }
  if (result.length > 2) throw invalid('emergencyContacts', 'como máximo dos personas de contacto');
  return result;
}

/**
 * @param {unknown} list
 * @returns {DietaryRestriction[]}
 */
function dietaryList(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > MAX.dietary) throw invalid('dietary', 'lista no válida');
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const type = String(item?.type ?? '');
    const codes = /** @type {Record<string, string> | undefined} */ (DIETARY_CODES[/** @type {keyof typeof DIETARY_CODES} */ (type)]);
    if (!codes) throw invalid('dietary', `tipo desconocido "${type}"`);
    const code = String(item?.code ?? '');
    if (!Object.hasOwn(codes, code)) throw invalid('dietary', `opción desconocida "${code}"`);
    const severity = item?.severity ? String(item.severity) : null;
    if (severity && !Object.values(DietarySeverity).includes(severity)) throw invalid('dietary', 'gravedad no válida');
    const detail = optionalText(item?.detail, 'dietary', MAX.detail);
    if (code === 'other' && !detail) throw invalid('dietary', 'indica cuál en «Otra»');
    const key = `${type}:${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({ type, code, severity: type === DietaryType.DIET ? null : severity, detail }));
  }
  return result;
}

/**
 * @param {unknown} list
 * @returns {AccessibilityNeed[]}
 */
function needsList(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list) || list.length > MAX.needs) throw invalid('accessibilityNeeds', 'lista no válida');
  const seen = new Set();
  const result = [];
  for (const item of list) {
    const code = String(item?.code ?? '');
    if (!Object.hasOwn(ACCESSIBILITY_NEEDS, code)) throw invalid('accessibilityNeeds', `opción desconocida "${code}"`);
    const detail = optionalText(item?.detail, 'accessibilityNeeds', MAX.detail);
    if (code === 'other' && !detail) throw invalid('accessibilityNeeds', 'indica cuál en «Otra necesidad»');
    if (seen.has(code)) continue;
    seen.add(code);
    result.push(Object.freeze({ code, detail }));
  }
  return result;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {Date}
 */
function requiredInstant(value, field) {
  const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
  if (value === undefined || value === null || Number.isNaN(date.getTime())) throw invalid(field, 'fecha no válida');
  return date;
}

/**
 * Creates a validated, immutable participant. Only the name is required here: quick
 * registrations from the letters screen are allowed and reported as incomplete profiles.
 * @param {Partial<ParticipantRecord> & { id: string, retreatId: string, givenNames: string, createdAt: Date | string, updatedAt?: Date | string }} props
 * @returns {Readonly<ParticipantRecord>}
 */
export function createParticipantRecord(props) {
  const source = props ?? /** @type {any} */ ({});
  const id = clean(source.id);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw invalid('id', `"${id}" no es válido`);
  const retreatId = clean(source.retreatId);
  if (!retreatId) throw invalid('retreatId', 'es obligatorio');

  const givenNames = clean(source.givenNames);
  if (!givenNames) throw invalid('givenNames', 'es obligatorio');
  const firstSurname = clean(source.firstSurname);
  const secondSurname = clean(source.secondSurname) || null;
  for (const [field, value] of /** @type {const} */ ([['givenNames', givenNames], ['firstSurname', firstSurname], ['secondSurname', secondSurname ?? '']])) {
    if (value.length > MAX.name) throw invalid(field, `máximo ${MAX.name} caracteres`);
  }
  const displayName = buildDisplayName({ givenNames, firstSurname, secondSurname });

  const aliasInput = source.aliases ?? [];
  if (!Array.isArray(aliasInput) || aliasInput.length > MAX.aliases) throw invalid('aliases', `máximo ${MAX.aliases}`);
  const seen = new Set([fold(displayName)]);
  const aliases = [];
  for (const alias of aliasInput) {
    const value = clean(alias);
    if (!value) continue;
    if (value.length > MAX.alias) throw invalid('aliases', `máximo ${MAX.alias} caracteres`);
    if (seen.has(fold(value))) continue;
    seen.add(fold(value));
    aliases.push(value);
  }

  const birthDate = optionalDateOnly(source.birthDate, 'birthDate');
  let age = null;
  if (source.age !== undefined && source.age !== null && source.age !== '') {
    age = Number(source.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) throw invalid('age', 'debe ser un número entre 0 y 120');
  }

  const email = clean(source.email).toLowerCase() || null;
  if (email && (email.length > MAX.email || !EMAIL.test(email))) throw invalid('email', 'no es un correo válido');

  const snores = source.snores ?? Snoring.UNKNOWN;
  if (!Object.values(Snoring).includes(snores)) throw invalid('snores', 'valor no válido');
  const status = source.status ?? ParticipantStatus.ACTIVE;
  if (!Object.values(ParticipantStatus).includes(status)) throw invalid('status', 'valor no válido');
  const createdAt = requiredInstant(source.createdAt, 'createdAt');

  return Object.freeze({
    id,
    retreatId,
    givenNames,
    firstSurname,
    secondSurname,
    displayName,
    aliases: Object.freeze(aliases),
    birthDate,
    age,
    email,
    phone: optionalPhone(source.phone, 'phone'),
    emergencyContacts: Object.freeze(emergencyContacts(source.emergencyContacts)),
    snores,
    dietary: Object.freeze(dietaryList(source.dietary)),
    accessibilityNeeds: Object.freeze(needsList(source.accessibilityNeeds)),
    supports: optionalText(source.supports, 'supports', MAX.supports),
    notes: optionalText(source.notes, 'notes', MAX.notes),
    status,
    withdrawnAt: status === ParticipantStatus.WITHDRAWN && source.withdrawnAt ? requiredInstant(source.withdrawnAt, 'withdrawnAt') : null,
    nameNeedsReview: source.nameNeedsReview === true,
    createdAt,
    updatedAt: source.updatedAt ? requiredInstant(source.updatedAt, 'updatedAt') : createdAt,
  });
}

/** Missing data that makes a profile incomplete (quick registrations, migrated names). */
export const MissingField = Object.freeze({
  FIRST_SURNAME: 'firstSurname',
  AGE: 'age',
  EMERGENCY_CONTACT: 'emergencyContact',
  NAME_REVIEW: 'nameReview',
});

/**
 * @param {Pick<ParticipantRecord, 'firstSurname' | 'age' | 'birthDate' | 'emergencyContacts' | 'nameNeedsReview'>} record
 * @returns {string[]}
 */
export function missingFields(record) {
  const missing = [];
  if (!record.firstSurname) missing.push(MissingField.FIRST_SURNAME);
  if (record.age === null && !record.birthDate) missing.push(MissingField.AGE);
  if (record.emergencyContacts.length === 0) missing.push(MissingField.EMERGENCY_CONTACT);
  if (record.nameNeedsReview) missing.push(MissingField.NAME_REVIEW);
  return missing;
}

/**
 * Age on a given local day (the retreat start, or today): from the birth date when known.
 * @param {Pick<ParticipantRecord, 'age' | 'birthDate'>} record
 * @param {string} onDay  YYYY-MM-DD
 * @returns {number | null}
 */
export function ageOn(record, onDay) {
  if (!record.birthDate) return record.age;
  const [by, bm, bd] = record.birthDate.split('-').map(Number);
  const [y, m, d] = onDay.split('-').map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age >= 0 ? age : null;
}
