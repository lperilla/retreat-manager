/**
 * Time-zone aware helpers built only on `Intl` (no external libraries, no I/O).
 */
import { AppError } from '../errors.js';

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatterCache = new Map();

/**
 * @param {string} timeZone
 * @returns {Intl.DateTimeFormat}
 */
function formatterFor(timeZone) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
    } catch {
      throw new AppError('INVALID_TIMEZONE', 500, undefined, { timeZone });
    }
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * @param {string} timeZone
 * @returns {string}
 */
export function assertTimeZone(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new AppError('INVALID_TIMEZONE', 500, undefined, { timeZone });
  }
  formatterFor(timeZone);
  return timeZone;
}

/**
 * @typedef {Object} WallClock
 * @property {number} year
 * @property {number} month   1..12
 * @property {number} day
 * @property {number} hour
 * @property {number} minute
 * @property {number} second
 */

/**
 * Wall-clock components of an instant in the given time zone.
 * @param {Date} date
 * @param {string} timeZone
 * @returns {WallClock}
 */
export function zonedParts(date, timeZone) {
  const parts = formatterFor(timeZone).formatToParts(date);
  /** @param {string} type */
  const get = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const hour = get('hour');
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: hour === 24 ? 0 : hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/**
 * @param {number} value
 * @param {number} [length]
 * @returns {string}
 */
function pad(value, length = 2) {
  return String(value).padStart(length, '0');
}

/**
 * Calendar day of an instant in the given time zone, as "YYYY-MM-DD".
 * @param {Date} date
 * @param {string} timeZone
 * @returns {string}
 */
export function toZonedDateKey(date, timeZone) {
  const { year, month, day } = zonedParts(date, timeZone);
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/**
 * Offset (ms) of the time zone at a given instant: wallClockAsUTC - instant.
 * @param {number} instantMs
 * @param {string} timeZone
 * @returns {number}
 */
function offsetAt(instantMs, timeZone) {
  const base = Math.floor(instantMs / 1000) * 1000;
  const p = zonedParts(new Date(base), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - base;
}

/**
 * Converts a wall-clock time in a time zone to an instant (handles DST transitions).
 * @param {{ year: number, month: number, day: number, hour?: number, minute?: number, second?: number }} wallClock
 * @param {string} timeZone
 * @returns {Date}
 */
export function zonedWallClockToInstant({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const firstOffset = offsetAt(asUtc, timeZone);
  let instant = asUtc - firstOffset;
  const secondOffset = offsetAt(instant, timeZone);
  if (secondOffset !== firstOffset) instant = asUtc - secondOffset;
  return new Date(instant);
}

/**
 * @typedef {{ kind: 'date', dateKey: string } | { kind: 'instant', instantMs: number }} AfterDateCriterion
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @param {number} [hour]
 * @param {number} [minute]
 * @param {number} [second]
 * @returns {boolean}
 */
function isValidCalendar(year, month, day, hour = 0, minute = 0, second = 0) {
  if (hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Parses an `afterDate` filter:
 * - "YYYY-MM-DD"            → letters whose LOCAL calendar day (in `timeZone`) is after that day;
 * - "YYYY-MM-DDTHH:mm[:ss]" → wall-clock time in `timeZone`, compared as an instant;
 * - ISO string with Z/offset or a Date → compared as an instant.
 * Comparison is always exclusive.
 * @param {string | Date | null | undefined} value
 * @param {string} timeZone
 * @returns {AfterDateCriterion | null}
 */
export function parseAfterDate(value, timeZone) {
  if (value === undefined || value === null || value === '') return null;
  assertTimeZone(timeZone);

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new AppError('INVALID_DATE', 400, undefined, { value: String(value) });
    return { kind: 'instant', instantMs: value.getTime() };
  }

  const input = String(value).trim();
  const dateOnly = input.match(DATE_ONLY);
  if (dateOnly) {
    const [, y, m, d] = dateOnly.map(Number);
    if (!isValidCalendar(y, m, d)) throw new AppError('INVALID_DATE', 400, undefined, { value: input });
    return { kind: 'date', dateKey: input };
  }

  const local = input.match(LOCAL_DATE_TIME);
  if (local) {
    const [, y, m, d, hh, mm, ss = 0] = local.map((part) => (part === undefined ? 0 : Number(part)));
    if (!isValidCalendar(y, m, d, hh, mm, ss)) throw new AppError('INVALID_DATE', 400, undefined, { value: input });
    const instant = zonedWallClockToInstant({ year: y, month: m, day: d, hour: hh, minute: mm, second: ss }, timeZone);
    return { kind: 'instant', instantMs: instant.getTime() };
  }

  if (ZONED_DATE_TIME.test(input)) {
    const ms = Date.parse(input);
    if (!Number.isNaN(ms)) return { kind: 'instant', instantMs: ms };
  }

  throw new AppError('INVALID_DATE', 400, undefined, { value: input });
}

/**
 * Exclusive comparison against a parsed criterion.
 * @param {Date} date
 * @param {AfterDateCriterion | null} criterion
 * @param {string} timeZone
 * @returns {boolean}
 */
export function isAfterCriterion(date, criterion, timeZone) {
  if (!criterion) return true;
  if (criterion.kind === 'date') return toZonedDateKey(date, timeZone) > criterion.dateKey;
  return date.getTime() > criterion.instantMs;
}
