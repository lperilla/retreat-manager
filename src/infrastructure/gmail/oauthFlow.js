import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { escapeHtml } from '../rendering/format.js';
import { GMAIL_SCOPES } from './oauthClient.js';

/**
 * @param {string} title
 * @param {string} message
 * @returns {string}
 */
function page(title, message) {
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title></head>`,
    `<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></main></body></html>`,
  ].join('');
}

/**
 * Loopback OAuth flow for a Desktop OAuth client (PKCE + state):
 * starts a temporary server on 127.0.0.1, builds the consent URL (scope gmail.readonly only)
 * and waits for Google to redirect back with the authorization code.
 * @param {{
 *   oauthClient: import('google-auth-library').OAuth2Client,
 *   openUrl?: (url: string) => void,
 *   onUrl: (url: string) => void,
 *   timeoutMs?: number,
 *   port?: number,
 *   scopes?: readonly string[],
 * }} options
 * @returns {Promise<{ code: string, codeVerifier: string, redirectUri: string }>}
 */
export async function runLoopbackAuthorization({ oauthClient, openUrl, onUrl, timeoutMs = 5 * 60_000, port = 0, scopes = GMAIL_SCOPES }) {
  const state = randomBytes(24).toString('hex');
  const { codeVerifier, codeChallenge } = await oauthClient.generateCodeVerifierAsync();

  return new Promise((resolve, reject) => {
    /** @type {ReturnType<typeof setTimeout>} */
    let timer;
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No encontrado');
        return;
      }
      const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'" };
      const finish = (/** @type {Error | null} */ error, /** @type {string} */ code = '') => {
        clearTimeout(timer);
        server.close();
        if (error) reject(error);
        else resolve({ code, codeVerifier, redirectUri });
      };
      if (url.searchParams.get('state') !== state) {
        res.writeHead(400, headers).end(page('Autorización rechazada', 'La respuesta no corresponde a esta solicitud. Vuelve a ejecutar npm run auth.'));
        finish(new Error('OAuth state mismatch'));
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error || !code) {
        res.writeHead(400, headers).end(page('Autorización cancelada', 'No se ha concedido acceso a Gmail. Puedes cerrar esta ventana.'));
        finish(new Error(`OAuth authorization failed: ${error ?? 'missing code'}`));
        return;
      }
      res.writeHead(200, headers).end(page('Autorización completada', 'Ya puedes cerrar esta ventana y volver a la terminal.'));
      finish(null, code);
    });

    /** @type {string} */
    let redirectUri = '';
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = /** @type {import('node:net').AddressInfo} */ (server.address());
      redirectUri = `http://127.0.0.1:${address.port}/oauth2callback`;
      const authUrl = oauthClient.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [...scopes],
        state,
        redirect_uri: redirectUri,
        code_challenge_method: /** @type {any} */ ('S256'),
        code_challenge: codeChallenge,
      });
      onUrl(authUrl);
      openUrl?.(authUrl);
      timer = setTimeout(() => {
        server.close();
        reject(new Error('Timed out waiting for the OAuth redirect'));
      }, timeoutMs);
      timer.unref?.();
    });
  });
}
