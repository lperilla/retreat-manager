/**
 * Formatting helpers shared by the export renderers (es-ES, configured time zone).
 */
import { LOCALE } from '../../domain/constants.js';

/** @type {Map<string, Intl.DateTimeFormat>} */
const dateFormatters = new Map();

/**
 * "jueves, 19 de noviembre de 2026, 23:50"
 * @param {Date} date
 * @param {string} timeZone
 * @returns {string}
 */
export function formatDateTime(date, timeZone) {
  let formatter = dateFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LOCALE, { timeZone, dateStyle: 'full', timeStyle: 'short' });
    dateFormatters.set(timeZone, formatter);
  }
  return formatter.format(date);
}

const numberFormatter = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 });

/**
 * "480 KB", "1,8 MB"
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${numberFormatter.format(value)} ${units[unit]}`;
}

/**
 * "1 carta" / "3 cartas"
 * @param {number} count
 * @returns {string}
 */
export function lettersLabel(count) {
  return count === 1 ? '1 carta' : `${count} cartas`;
}

/**
 * Escapes text for HTML element content and attribute values.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
