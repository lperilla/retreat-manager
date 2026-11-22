/**
 * Spanish (es-ES) formatting helpers for the dashboard.
 */
import { state } from './state.js';

const LOCALE = 'es-ES';
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: 'auto', style: 'short' });

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map();

/**
 * @param {Intl.DateTimeFormatOptions} options
 */
function formatter(options) {
  const key = `${state.info?.timeZone ?? ''}|${JSON.stringify(options)}`;
  let value = formatters.get(key);
  if (!value) {
    value = new Intl.DateTimeFormat(LOCALE, { timeZone: state.info?.timeZone, ...options });
    formatters.set(key, value);
  }
  return value;
}

/**
 * "19 nov 2026, 23:50" in the configured time zone.
 * @param {string | null | undefined} iso
 */
export function formatDateTime(iso) {
  if (!iso) return '—';
  return formatter({ dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

/**
 * "19 nov, 23:50" (compact, for letter rows).
 * @param {string | null | undefined} iso
 */
export function formatShortDateTime(iso) {
  if (!iso) return '—';
  return formatter({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

/**
 * "jueves, 19 de noviembre de 2026, 23:50"
 * @param {string | null | undefined} iso
 */
export function formatLongDateTime(iso) {
  if (!iso) return '—';
  return formatter({ dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso));
}

/**
 * "hace 5 min", "ayer", "ahora"
 * @param {string | null | undefined} iso
 */
export function relativeTime(iso) {
  if (!iso) return 'nunca';
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return 'ahora mismo';
  if (abs < 3600) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), 'hour');
  return relative.format(Math.round(seconds / 86400), 'day');
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} plural
 */
export function plural(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** @param {number} n */
export const lettersLabel = (n) => plural(n, 'carta', 'cartas');

/**
 * "3 cartas nuevas · 1 actualizada · 0 eliminadas"
 * @param {{ added: number, updated: number, deleted: number }} result
 */
export function syncResultSummary(result) {
  const counts = [
    plural(result.added, 'carta nueva', 'cartas nuevas'),
    plural(result.updated, 'actualizada', 'actualizadas'),
    plural(result.deleted, 'eliminada', 'eliminadas'),
  ].join(' · ');
  const reason = FULL_SYNC_REASONS[result.fullSyncReason];
  return reason ? `${reason}. ${counts}` : counts;
}

/** Explains an automatic full sync (the ones the user did not ask for). */
const FULL_SYNC_REASONS = /** @type {Record<string, string>} */ ({
  'selection-changed': 'Se ha leído todo el buzón porque cambió el filtro de Gmail (GMAIL_QUERY, GMAIL_LABEL_ID o GMAIL_START_DATE)',
  'cursor-expired': 'Se ha leído todo el buzón porque Gmail ya no conservaba el historial desde la última vez',
});

/**
 * @param {number | null | undefined} ms
 */
export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} s`;
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`;
}

/**
 * @param {number} bytes
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
  return `${value.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

/**
 * Display name from a From header ('"Ana Pérez" <ana@x.com>' → 'Ana Pérez').
 * @param {string} from
 */
export function senderName(from) {
  const match = /^\s*"?([^"<]*?)"?\s*<[^>]*>\s*$/.exec(from ?? '');
  return match && match[1].trim() ? match[1].trim() : from || 'Remitente desconocido';
}

/**
 * Accent/case-insensitive normalization for client-side search.
 * @param {string} value
 */
export function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Spanish collation for names.
 * @param {string} a
 * @param {string} b
 */
export function compareNames(a, b) {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}
