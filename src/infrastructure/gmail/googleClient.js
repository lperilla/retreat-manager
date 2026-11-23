/**
 * Gmail-only Google client (`@googleapis/gmail`).
 *
 * The full `googleapis` package ships ~340 API modules (thousands of files: slow to install and
 * to scan with an antivirus). Only Gmail is used, so only its package is installed.
 * This is the single place that knows that package.
 */
import { auth, gmail } from '@googleapis/gmail';

/** OAuth2 client class (google-auth-library). */
export const OAuth2 = auth.OAuth2;

/**
 * @param {import('google-auth-library').OAuth2Client} client
 */
export function createGmailClient(client) {
  return gmail({ version: 'v1', auth: client });
}
