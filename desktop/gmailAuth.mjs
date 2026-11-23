/**
 * "Conectar con Gmail" for the desktop app: the same consent flow as `npm run auth`, without a
 * terminal. The credentials.json the user picks is copied to the server folder and the token is
 * saved next to it.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { OAuth2 } from '../src/infrastructure/gmail/googleClient.js';
import { gmailScopesFor, readClientSecrets, writeTokenFile } from '../src/infrastructure/gmail/oauthClient.js';
import { runLoopbackAuthorization } from '../src/infrastructure/gmail/oauthFlow.js';
import { readSettingsEnv, settingsPath } from '../src/infrastructure/settings/settingsFile.js';

/**
 * @param {{ home: string, credentialsFile: string, openUrl: (url: string) => void }} options
 */
export async function authorizeGmail({ home, credentialsFile, openUrl }) {
  mkdirSync(home, { recursive: true });
  const target = join(home, 'credentials.json');
  // Validate before replacing the current file.
  await readClientSecrets(credentialsFile);
  copyFileSync(credentialsFile, target);
  const secrets = await readClientSecrets(target);
  const oauthClient = new OAuth2(secrets.clientId, secrets.clientSecret);
  // Read-only unless Gmail labels are enabled in Configuración (labels need gmail.modify).
  const labels = readSettingsEnv(settingsPath(join(home, 'data'))).GMAIL_LABELS_ENABLED === 'true' || process.env.GMAIL_LABELS_ENABLED === 'true';
  const { code, codeVerifier, redirectUri } = await runLoopbackAuthorization({ oauthClient, openUrl, onUrl: () => {}, scopes: gmailScopesFor({ labels }) });
  const { tokens } = await oauthClient.getToken({ code, codeVerifier, redirect_uri: redirectUri });
  await writeTokenFile(join(home, 'token.json'), /** @type {Record<string, unknown>} */ (tokens));
  return { hasRefreshToken: Boolean(tokens.refresh_token) };
}
