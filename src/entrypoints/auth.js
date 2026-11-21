/**
 * `npm run auth`: OAuth consent flow (scope gmail.readonly only). Writes token.json.
 * Requires credentials.json (Google Cloud → OAuth client ID → Desktop app).
 */
import { spawn } from 'node:child_process';

import dotenv from 'dotenv';

import { describeError } from '../application/services/errorDescription.js';
import { loadConfig } from '../composition/config.js';
import { OAuth2, createGmailClient } from '../infrastructure/gmail/googleClient.js';
import { GMAIL_SCOPES, readClientSecrets, writeTokenFile } from '../infrastructure/gmail/oauthClient.js';
import { runLoopbackAuthorization } from '../infrastructure/gmail/oauthFlow.js';

dotenv.config({ quiet: true });

/**
 * Best-effort: open the consent page in the default browser.
 * @param {string} url
 */
function openBrowser(url) {
  const command =
    process.platform === 'win32'
      ? { file: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
      : process.platform === 'darwin'
        ? { file: 'open', args: [url] }
        : { file: 'xdg-open', args: [url] };
  try {
    const child = spawn(command.file, command.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed anyway.
  }
}

async function main() {
  const config = loadConfig();
  const { credentialsPath, tokenPath } = config.gmail;
  const secrets = await readClientSecrets(credentialsPath);
  if (secrets.type !== 'installed') {
    process.stdout.write('Warning: credentials.json is a "web" client. A "Desktop app" OAuth client is recommended.\n');
  }

  const oauthClient = new OAuth2(secrets.clientId, secrets.clientSecret);
  process.stdout.write(`Requesting access with scope: ${GMAIL_SCOPES.join(' ')}\n`);

  const { code, codeVerifier, redirectUri } = await runLoopbackAuthorization({
    oauthClient,
    openUrl: openBrowser,
    onUrl: (url) => process.stdout.write(`\nOpen this URL in your browser to authorize read-only Gmail access:\n\n${url}\n\nWaiting for the authorization (5 minutes)...\n`),
  });

  const { tokens } = await oauthClient.getToken({ code, codeVerifier, redirect_uri: redirectUri });
  if (!tokens.refresh_token) {
    process.stdout.write('Warning: Google did not return a refresh token. Revoke the app access in your Google account and run "npm run auth" again.\n');
  }
  await writeTokenFile(tokenPath, /** @type {Record<string, unknown>} */ (tokens));

  oauthClient.setCredentials(tokens);
  const profile = await createGmailClient(oauthClient).users.getProfile({ userId: 'me' });
  process.stdout.write(`\nAuthorized mailbox: ${profile.data.emailAddress}\ntoken.json written to ${tokenPath}\nKeep credentials.json and token.json private (they are git-ignored).\n`);
}

main().catch((error) => {
  const details = /** @type {{ details?: unknown }} */ (error)?.details;
  process.stderr.write(`Authorization failed: ${describeError(error)}${details ? ` ${JSON.stringify(details)}` : ''}\n`);
  process.exit(1);
});
