/**
 * Shared startup for every entrypoint.
 *
 * The server may be launched from an arbitrary working directory,
 * so `.env` and every relative path (data/, exports/, credentials.json…) are resolved
 * against the PROJECT ROOT, never against `process.cwd()`.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { loadConfig } from '../composition/config.js';
import { readSettingsEnv, settingsPath } from '../infrastructure/settings/settingsFile.js';

/** Absolute path of the repository root (two levels above this file). */
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Loads `.env` silently and parses the config.
 * `RETREAT_ENV_FILE` may point to another env file. `RETREAT_HOME` moves the base folder of
 * `.env`, `data/`, `credentials.json` and the other relative paths (the desktop app keeps them
 * in the user's profile instead of the install folder).
 * @param {{ env?: Record<string, string | undefined>, rootDir?: string }} [options]
 * @returns {Readonly<import('../composition/config.js').AppConfig>}
 */
export function loadEnvironment({ env = process.env, rootDir = env.RETREAT_HOME || PROJECT_ROOT } = {}) {
  const envFile = env.RETREAT_ENV_FILE || join(rootDir, '.env');
  dotenv.config({ path: envFile, quiet: true, processEnv: /** @type {Record<string, string>} */ (env) });
  // Settings saved from the dashboard (data/settings.json) override the same variables of .env.
  const base = loadConfig(env, { rootDir });
  const saved = readSettingsEnv(settingsPath(base.dataDir));
  return Object.keys(saved).length > 0 ? loadConfig({ ...env, ...saved }, { rootDir }) : base;
}
