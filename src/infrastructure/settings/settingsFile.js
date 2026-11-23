import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { AppError } from '../../domain/errors.js';

/**
 * Settings editable from the dashboard ("Configuración"). They are stored in
 * `<DATA_DIR>/settings.json` and override the same variable in `.env`. Secrets (access code,
 * database URI, Google credentials) are NOT editable here and are never written to this file.
 *
 * @type {ReadonlyArray<{ key: string, env: string, type: 'bool' | 'text' | 'number', restart?: boolean }>}
 */
export const SETTING_FIELDS = Object.freeze([
  { key: 'labelsEnabled', env: 'GMAIL_LABELS_ENABLED', type: 'bool' },
  { key: 'labelPrefix', env: 'GMAIL_LABEL_PREFIX', type: 'text' },
  { key: 'printedLabel', env: 'GMAIL_PRINTED_LABEL', type: 'text' },
  { key: 'query', env: 'GMAIL_QUERY', type: 'text' },
  { key: 'labelId', env: 'GMAIL_LABEL_ID', type: 'text' },
  { key: 'startDate', env: 'GMAIL_START_DATE', type: 'text' },
  { key: 'concurrency', env: 'GMAIL_CONCURRENCY', type: 'number' },
  { key: 'requestsPerSecond', env: 'GMAIL_MAX_REQUESTS_PER_SECOND', type: 'number' },
  { key: 'syncIntervalMinutes', env: 'SYNC_INTERVAL_MINUTES', type: 'number', restart: true },
]);

/** @param {string} dataDir */
export function settingsPath(dataDir) {
  return join(dataDir, 'settings.json');
}

/**
 * Saved settings as environment-style strings ({} when there is no file or it is unreadable).
 * @param {string} filePath
 * @returns {Record<string, string>}
 */
export function readSettingsEnv(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    const values = parsed?.values;
    if (!values || typeof values !== 'object') return {};
    const allowed = new Set(SETTING_FIELDS.map((field) => field.env));
    return Object.fromEntries(Object.entries(values).filter(([name, value]) => allowed.has(name) && typeof value === 'string'));
  } catch {
    return {};
  }
}

/**
 * @param {string} filePath
 * @param {Record<string, string>} values
 */
export async function writeSettingsEnv(filePath, values) {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ version: 1, values }, null, 2)}\n`, 'utf8');
  try {
    await rename(temp, filePath);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/**
 * Typed form values → environment strings. Unknown keys are ignored; wrong types are rejected.
 * @param {Record<string, unknown>} input
 * @returns {Record<string, string>}
 */
export function settingsInputToEnv(input) {
  const env = /** @type {Record<string, string>} */ ({});
  for (const field of SETTING_FIELDS) {
    const value = input?.[field.key];
    if (value === undefined || value === null) continue;
    const bad = () => new AppError('VALIDATION_ERROR', 400, `El valor de «${field.key}» no es válido.`, { field: field.key });
    if (field.type === 'bool') {
      if (typeof value !== 'boolean') throw bad();
      env[field.env] = value ? 'true' : 'false';
    } else if (field.type === 'number') {
      if (typeof value !== 'number' && typeof value !== 'string') throw bad();
      env[field.env] = String(value).trim();
    } else {
      if (typeof value !== 'string' || value.length > 500) throw bad();
      env[field.env] = value.trim();
    }
  }
  return env;
}

/**
 * Values of the editable settings as the UI shows them (from the effective config).
 * @param {import('../../composition/config.js').AppConfig} config
 */
export function settingsFromConfig(config) {
  return {
    labelsEnabled: config.gmail.labels.enabled,
    labelPrefix: config.gmail.labels.participantPrefix,
    printedLabel: config.gmail.labels.printedLabel,
    query: config.gmail.query,
    labelId: config.gmail.labelId ?? '',
    startDate: config.gmail.startDate ?? '',
    concurrency: config.gmail.concurrency,
    requestsPerSecond: config.gmail.requestsPerSecond,
    syncIntervalMinutes: config.sync.intervalMinutes,
  };
}
