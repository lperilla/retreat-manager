/**
 * Shared startup for every entrypoint.
 *
 * MCP clients (e.g. Claude Desktop) launch the server from an arbitrary working directory,
 * so `.env` and every relative path (data/, exports/, credentials.json…) are resolved
 * against the PROJECT ROOT, never against `process.cwd()`.
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { loadConfig } from '../composition/config.js';

/** Absolute path of the repository root (two levels above this file). */
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Loads `.env` silently (stdout must stay clean for the MCP protocol) and parses the config.
 * `RETREAT_ENV_FILE` may point to another env file.
 * @param {{ env?: Record<string, string | undefined>, rootDir?: string }} [options]
 * @returns {Readonly<import('../composition/config.js').AppConfig>}
 */
export function loadEnvironment({ env = process.env, rootDir = PROJECT_ROOT } = {}) {
  const envFile = env.RETREAT_ENV_FILE || join(rootDir, '.env');
  dotenv.config({ path: envFile, quiet: true, processEnv: /** @type {Record<string, string>} */ (env) });
  return loadConfig(env, { rootDir });
}
