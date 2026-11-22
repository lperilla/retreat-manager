import { resolve } from 'node:path';

import { DEFAULTS } from '../domain/constants.js';
import { AppError } from '../domain/errors.js';
import { assertTimeZone, zonedWallClockToInstant } from '../domain/services/time.js';

const LOG_LEVELS = Object.freeze(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const PERSISTENCE_KINDS = Object.freeze(['mongo', 'json']);

/**
 * @typedef {Object} AppConfig
 * @property {string}  host
 * @property {number}  port
 * @property {string}  timeZone
 * @property {string|null} accessToken
 * @property {boolean} demoMode
 * @property {{ minConfidence: number, bodyScanChars: number }} assignment
 * @property {{ query: string, labelId: string | null, startDate: string | null, startAt: Date | null, credentialsPath: string, tokenPath: string, concurrency: number }} gmail
 *           `startDate` (YYYY-MM-DD, local day in `timeZone`) → `startAt`: first instant of that day.
 * @property {string}  exportDir
 * @property {string}  cacheDir
 * @property {number}  maxAttachmentMb
 * @property {'mongo' | 'json'} persistence
 * @property {string}  dataDir           Directory of the JSON stores (PERSISTENCE=json).
 * @property {string}  participantsFile  Participants list loaded at startup (outside demo mode).
 * @property {{ uri: string, db: string, uriTest: string | null }} mongo
 * @property {{ intervalMinutes: number, minIntervalSeconds: number, lockTtlSeconds: number, runsTtlDays: number }} sync
 * @property {string}  logLevel
 */

/**
 * @param {string} name
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(name, reason) {
  return new AppError('CONFIG_ERROR', 500, undefined, { variable: name, reason });
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {string} fallback
 * @returns {string}
 */
function text(env, name, fallback) {
  const value = env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function bool(env, name, fallback) {
  const value = text(env, name, '').toLowerCase();
  if (value === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw invalid(name, 'must be true or false');
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 * @param {number} fallback
 * @param {{ min: number, max: number, integer?: boolean }} limits
 * @returns {number}
 */
function number(env, name, fallback, { min, max, integer = true }) {
  const raw = text(env, name, '');
  if (raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw invalid(name, `must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}`);
  }
  return value;
}

/**
 * GMAIL_START_DATE: "YYYY-MM-DD", the first local day (in `timeZone`) whose mail is read.
 * @param {Record<string, string | undefined>} env
 * @param {string} timeZone
 * @returns {{ startDate: string | null, startAt: Date | null }}
 */
function startDate(env, timeZone) {
  const raw = text(env, 'GMAIL_START_DATE', '');
  if (raw === '') return { startDate: null, startAt: null };
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const probe = match ? new Date(Date.UTC(year, month - 1, day)) : null;
  if (!probe || probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw invalid('GMAIL_START_DATE', 'must be a date in the form YYYY-MM-DD');
  }
  return { startDate: raw, startAt: zonedWallClockToInstant({ year, month, day }, timeZone) };
}

/**
 * Parses and validates the environment. Relative paths are resolved against `rootDir`.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ rootDir?: string }} [options]
 * @returns {Readonly<AppConfig>}
 */
export function loadConfig(env = process.env, { rootDir = process.cwd() } = {}) {
  const timeZone = text(env, 'TZ', DEFAULTS.TIME_ZONE);
  try {
    assertTimeZone(timeZone);
  } catch {
    throw invalid('TZ', `unknown time zone "${timeZone}"`);
  }

  const persistence = text(env, 'PERSISTENCE', 'mongo').toLowerCase();
  if (!PERSISTENCE_KINDS.includes(persistence)) throw invalid('PERSISTENCE', 'must be "mongo" or "json"');

  const logLevel = text(env, 'LOG_LEVEL', 'info').toLowerCase();
  if (!LOG_LEVELS.includes(logLevel)) throw invalid('LOG_LEVEL', `must be one of ${LOG_LEVELS.join(', ')}`);

  const path = (/** @type {string} */ name, /** @type {string} */ fallback) => resolve(rootDir, text(env, name, fallback));
  const dataDir = path('DATA_DIR', './data');

  return Object.freeze({
    host: text(env, 'HOST', '127.0.0.1'),
    port: number(env, 'PORT', 3000, { min: 1, max: 65535 }),
    timeZone,
    accessToken: text(env, 'ACCESS_TOKEN', '') || null,
    demoMode: bool(env, 'DEMO_MODE', false),
    assignment: Object.freeze({
      minConfidence: number(env, 'ASSIGNMENT_MIN_CONFIDENCE', DEFAULTS.ASSIGNMENT_MIN_CONFIDENCE, {
        min: 0,
        max: 1,
        integer: false,
      }),
      bodyScanChars: number(env, 'BODY_SCAN_CHARS', DEFAULTS.BODY_SCAN_CHARS, { min: 0, max: 100000 }),
    }),
    gmail: Object.freeze({
      query: text(env, 'GMAIL_QUERY', ''),
      labelId: text(env, 'GMAIL_LABEL_ID', '') || null,
      ...startDate(env, timeZone),
      credentialsPath: path('GOOGLE_CREDENTIALS_PATH', './credentials.json'),
      tokenPath: path('GOOGLE_TOKEN_PATH', './token.json'),
      concurrency: number(env, 'GMAIL_CONCURRENCY', 5, { min: 1, max: 20 }),
    }),
    exportDir: path('EXPORT_DIR', './exports'),
    cacheDir: path('CACHE_DIR', './cache'),
    maxAttachmentMb: number(env, 'MAX_ATTACHMENT_MB', 15, { min: 1, max: 1024 }),
    persistence: /** @type {'mongo' | 'json'} */ (persistence),
    dataDir,
    participantsFile: resolve(rootDir, text(env, 'PARTICIPANTS_FILE', resolve(dataDir, 'participants.json'))),
    mongo: Object.freeze({
      uri: text(env, 'MONGODB_URI', ''),
      db: text(env, 'MONGODB_DB', 'retreat_mail'),
      uriTest: text(env, 'MONGODB_URI_TEST', '') || null,
    }),
    sync: Object.freeze({
      intervalMinutes: number(env, 'SYNC_INTERVAL_MINUTES', 0, { min: 0, max: 1440 }),
      minIntervalSeconds: number(env, 'SYNC_MIN_INTERVAL_SECONDS', DEFAULTS.SYNC_MIN_INTERVAL_SECONDS, {
        min: 0,
        max: 86400,
      }),
      lockTtlSeconds: number(env, 'SYNC_LOCK_TTL_SECONDS', DEFAULTS.SYNC_LOCK_TTL_SECONDS, { min: 10, max: 86400 }),
      runsTtlDays: number(env, 'SYNC_RUNS_TTL_DAYS', 90, { min: 1, max: 3650 }),
    }),
    logLevel,
  });
}
