/**
 * Gmail-only entry point of the `googleapis` package.
 *
 * `import { google } from 'googleapis'` loads all ~340 Google APIs (≈1.3 s warm, up to ~20 s
 * on a cold Windows start with antivirus scanning). The package ships one module per API;
 * loading only Gmail takes ~150 ms. This is the single place that knows that path.
 */
import { auth, gmail } from 'googleapis/build/src/apis/gmail/index.js';

/** OAuth2 client class (google-auth-library). */
export const OAuth2 = auth.OAuth2;

/**
 * @param {import('google-auth-library').OAuth2Client} client
 */
export function createGmailClient(client) {
  return gmail({ version: 'v1', auth: client });
}
