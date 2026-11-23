import { AppError } from '../../domain/errors.js';
import { gmailScopesFor, readClientSecrets, writeTokenFile } from './oauthClient.js';
import { runLoopbackAuthorization } from './oauthFlow.js';

/**
 * Starts the Gmail consent from the running server (the same flow as `npm run auth`): a
 * temporary server on 127.0.0.1 receives Google's answer, so the consent must happen in a
 * browser of the server computer. Resolves as soon as the consent URL is ready; `done`
 * settles when the user has accepted (token.json written) or the flow failed / timed out.
 * @param {{
 *   config: import('../../composition/config.js').AppConfig,
 *   openUrl?: (url: string) => void,
 * }} options
 * @returns {Promise<{ authUrl: string, done: Promise<{ hasRefreshToken: boolean }> }>}
 */
export async function startGmailAuthorization({ config, openUrl }) {
  let secrets;
  try {
    secrets = await readClientSecrets(config.gmail.credentialsPath);
  } catch (error) {
    if (/** @type {{ code?: string }} */ (error)?.code === 'MAIL_SOURCE_NOT_CONFIGURED') {
      throw new AppError('GMAIL_CREDENTIALS_MISSING', 409, undefined, { file: config.gmail.credentialsPath });
    }
    throw error;
  }
  // googleapis is large: loaded only when someone authorizes.
  const { OAuth2 } = await import('./googleClient.js');
  const oauthClient = new OAuth2(secrets.clientId, secrets.clientSecret);
  const scopes = gmailScopesFor({ labels: config.gmail.labels.enabled });

  /** @type {(url: string) => void} */
  let urlReady = () => {};
  const url = new Promise((resolve) => {
    urlReady = resolve;
  });
  const done = runLoopbackAuthorization({ oauthClient, openUrl, onUrl: (authUrl) => urlReady(authUrl), scopes }).then(
    async ({ code, codeVerifier, redirectUri }) => {
      const { tokens } = await oauthClient.getToken({ code, codeVerifier, redirect_uri: redirectUri });
      await writeTokenFile(config.gmail.tokenPath, /** @type {Record<string, unknown>} */ (tokens));
      return { hasRefreshToken: Boolean(tokens.refresh_token) };
    },
  );
  // If the flow fails before the URL exists (e.g. no free port), report that error.
  const authUrl = await Promise.race([url, done.then(() => Promise.reject(new Error('OAuth flow ended without a URL')))]);
  return { authUrl: /** @type {string} */ (authUrl), done };
}
