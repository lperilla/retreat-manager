import { AppError } from '../../../domain/errors.js';
import { zonedWallClockToInstant } from '../../../domain/services/time.js';

/**
 * A retreat groups everything the application stores: participants, letters, print status
 * and, later, rooms and tables. Only ONE retreat is active at a time; a closed retreat keeps
 * just its name, dates and anonymous totals (all personal data is deleted when it closes).
 *
 * @typedef {Object} Retreat
 * @property {string}      id
 * @property {string}      name
 * @property {string|null} startDate   YYYY-MM-DD (local day).
 * @property {string|null} endDate     YYYY-MM-DD (local day, inclusive).
 * @property {'active' | 'closed'} status
 * @property {Date|null}   mailFrom    Letters received before this instant are ignored (they
 *                                     belong to the previous, already deleted, retreat).
 * @property {Date}        createdAt
 * @property {Date|null}   closedAt
 * @property {{ participants: number, letters: number } | null} summary  Anonymous totals of a closed retreat.
 */

export const RetreatStatus = Object.freeze({ ACTIVE: 'active', CLOSED: 'closed' });

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(reason) {
  return new AppError('INVALID_RETREAT', 400, undefined, { reason });
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {string | null}
 */
export function optionalDateOnly(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  const match = DATE_ONLY.exec(text);
  if (!match) throw invalid(`${field} must be YYYY-MM-DD`);
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw invalid(`${field} is not a valid date`);
  }
  return text;
}

/**
 * @param {unknown} value
 * @returns {Date | null}
 */
function optionalInstant(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = value instanceof Date ? value : new Date(/** @type {any} */ (value));
  if (Number.isNaN(date.getTime())) throw invalid('invalid date');
  return date;
}

/**
 * @param {Partial<Retreat> & { id: string, createdAt: Date | string }} props
 * @returns {Readonly<Retreat>}
 */
export function createRetreat(props) {
  const source = props ?? /** @type {any} */ ({});
  if (typeof source.id !== 'string' || !source.id.trim()) throw invalid('id is required');
  const name = String(source.name ?? '').replace(/\s+/g, ' ').trim() || 'Retiro';
  if (name.length > 120) throw invalid('name is too long');
  const startDate = optionalDateOnly(source.startDate, 'startDate');
  const endDate = optionalDateOnly(source.endDate, 'endDate');
  if (startDate && endDate && endDate < startDate) throw invalid('endDate must not be before startDate');
  const status = source.status ?? RetreatStatus.ACTIVE;
  if (!Object.values(RetreatStatus).includes(status)) throw invalid(`unknown status "${status}"`);
  const createdAt = optionalInstant(source.createdAt);
  if (!createdAt) throw invalid('createdAt is required');
  return Object.freeze({
    id: source.id.trim(),
    name,
    startDate,
    endDate,
    status,
    mailFrom: optionalInstant(source.mailFrom),
    createdAt,
    closedAt: optionalInstant(source.closedAt),
    summary: source.summary
      ? Object.freeze({ participants: Number(source.summary.participants) || 0, letters: Number(source.summary.letters) || 0 })
      : null,
  });
}

/**
 * Instant from which every personal datum of the retreat is deleted automatically:
 * the end of the last day of the retreat plus `retentionDays` full days (local time).
 * @param {Pick<Retreat, 'endDate'>} retreat
 * @param {{ retentionDays: number, timeZone: string }} options
 * @returns {Date | null}  null while the end date is unknown.
 */
export function deletionDate(retreat, { retentionDays, timeZone }) {
  if (!retreat.endDate) return null;
  const [year, month, day] = retreat.endDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1 + retentionDays));
  return zonedWallClockToInstant(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
    timeZone,
  );
}

/**
 * @param {Pick<Retreat, 'endDate' | 'status'>} retreat
 * @param {Date} now
 * @param {{ retentionDays: number, timeZone: string }} options
 * @returns {boolean}
 */
export function isDeletionDue(retreat, now, options) {
  if (retreat.status !== RetreatStatus.ACTIVE) return false;
  const due = deletionDate(retreat, options);
  return due !== null && now.getTime() >= due.getTime();
}

/**
 * True once the last day of the retreat is over (local time).
 * @param {Pick<Retreat, 'endDate'>} retreat
 * @param {Date} now
 * @param {string} timeZone
 * @returns {boolean}
 */
export function hasEnded(retreat, now, timeZone) {
  const end = deletionDate(retreat, { retentionDays: 0, timeZone });
  return end !== null && now.getTime() >= end.getTime();
}
