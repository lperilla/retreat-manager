import { chmod, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

import { AppError } from '../../domain/errors.js';
import { OAuth2 } from './googleClient.js';

/** Default scope: read-only access to Gmail. */
export const GMAIL_SCOPES = Object.freeze(['https://www.googleapis.com/auth/gmail.readonly']);

/**
 * Scope requested only when label synchronization is enabled (GMAIL_LABELS_ENABLED): the
 * minimum that lets the app read mail AND change labels on messages. It cannot send or
 * permanently delete mail.
 */
export const GMAIL_LABEL_SCOPES = Object.freeze(['https://www.googleapis.com/auth/gmail.modify']);

/**
 * @param {{ labels?: boolean }} [options]
 * @returns {readonly string[]}
 */
export function gmailScopesFor({ labels = false } = {}) {
  return labels ? GMAIL_LABEL_SCOPES : GMAIL_SCOPES;
}

/**
 * @typedef {Object} ClientSecrets
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {'installed' | 'web'} type
 */

/**
 * @param {string} reason
 * @param {Record<string, unknown>} [extra]
 * @returns {AppError}
 */
function notConfigured(reason, extra = {}) {
  return new AppError('MAIL_SOURCE_NOT_CONFIGURED', 503, undefined, { reason, ...extra });
}

/**
 * Reads the OAuth client downloaded from Google Cloud (Desktop app → "installed").
 * @param {string} credentialsPath
 * @returns {Promise<ClientSecrets>}
 */
export async function readClientSecrets(credentialsPath) {
  let raw;
  try {
    raw = await readFile(credentialsPath, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw notConfigured('credentials.json not found', { file: credentialsPath });
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw notConfigured('credentials.json is not valid JSON', { file: credentialsPath });
  }
  const type = parsed?.installed ? 'installed' : parsed?.web ? 'web' : null;
  const section = type ? parsed[type] : null;
  if (!type || typeof section?.client_id !== 'string' || typeof section?.client_secret !== 'string') {
    throw notConfigured('credentials.json must contain an "installed" (Desktop app) OAuth client', { file: credentialsPath });
  }
  return { clientId: section.client_id, clientSecret: section.client_secret, type };
}

/**
 * Writes token.json atomically (temp file + rename, so readers never see a partial file),
 * readable only by the current user where the OS supports it.
 * @param {string} tokenPath
 * @param {Record<string, unknown>} tokens
 */
export async function writeTokenFile(tokenPath, tokens) {
  const tempPath = `${tokenPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(tokens, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  for (let attempt = 1; ; attempt += 1) {
    try {
      await rename(tempPath, tokenPath);
      break;
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= 5) {
        await rm(tempPath, { force: true });
        throw error;
      }
      await delay(25 * attempt);
    }
  }
  await chmod(tokenPath, 0o600).catch(() => {});
}

/**
 * Builds an authorized OAuth2 client from credentials.json + token.json. Refreshed tokens
 * are written back to token.json (keeping the refresh token).
 * @param {{
 *   credentialsPath: string,
 *   tokenPath: string,
 *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
 *   labels?: boolean,
 * }} options
 */
export async function loadAuthorizedClient({ credentialsPath, tokenPath, logger, labels = false }) {
  const secrets = await readClientSecrets(credentialsPath);
  let tokens;
  try {
    tokens = JSON.parse(await readFile(tokenPath, 'utf8'));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') {
      throw notConfigured('token.json not found; run "npm run auth"', { file: tokenPath });
    }
    throw notConfigured('token.json is not valid JSON; run "npm run auth" again', { file: tokenPath });
  }
  if (!tokens?.refresh_token && !tokens?.access_token) {
    throw notConfigured('token.json has no tokens; run "npm run auth" again', { file: tokenPath });
  }
  const scopes = String(tokens.scope ?? GMAIL_SCOPES[0]).split(/\s+/).filter(Boolean);
  const allowed = gmailScopesFor({ labels });
  const unexpected = scopes.filter((scope) => !allowed.includes(scope));
  if (unexpected.length > 0) {
    logger.warn({ unexpected }, `token.json grants more scopes than ${allowed[0].split('/').pop()}; re-run "npm run auth" to reduce them`);
  }
  if (labels && !scopes.includes(GMAIL_LABEL_SCOPES[0])) {
    logger.warn('Gmail labels are enabled but token.json lacks the gmail.modify scope; run "npm run auth" again to grant it');
  }

  const client = new OAuth2(secrets.clientId, secrets.clientSecret);
  client.setCredentials(tokens);
  client.on('tokens', (fresh) => {
    const merged = { ...tokens, ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token };
    tokens = merged;
    writeTokenFile(tokenPath, merged).catch((error) =>
      logger.warn({ reason: String(error?.message ?? error) }, 'Could not persist refreshed Gmail tokens'),
    );
  });
  return client;
}
