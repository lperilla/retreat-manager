import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { GMAIL_SCOPES, loadAuthorizedClient, readClientSecrets } from '../../src/infrastructure/gmail/oauthClient.js';
import { runLoopbackAuthorization } from '../../src/infrastructure/gmail/oauthFlow.js';
import { createLimiter, isRetryable, withRetry } from '../../src/infrastructure/gmail/retry.js';
import { httpError } from '../helpers/gmailFakes.js';

describe('withRetry', () => {
  it('retries retryable errors with exponential backoff and honours Retry-After', async () => {
    const delays = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts === 1) throw httpError(500);
        if (attempts === 2) throw httpError(429, { 'retry-after': '3' });
        return 'ok';
      },
      { sleep: async (ms) => delays.push(ms), random: () => 1, baseDelayMs: 100 },
    );
    assert.equal(result, 'ok');
    assert.deepEqual(delays, [100, 3000]);
  });

  it('gives up after the configured retries and never retries 400/401/404', async () => {
    let attempts = 0;
    await assert.rejects(
      withRetry(
        async () => {
          attempts += 1;
          throw httpError(503);
        },
        { retries: 2, sleep: async () => {} },
      ),
      /HTTP 503/,
    );
    assert.equal(attempts, 3);
    for (const status of [400, 401, 404]) assert.equal(isRetryable(httpError(status)), false);
    assert.equal(isRetryable(Object.assign(new Error('reset'), { code: 'ECONNRESET' })), true);
    const quota = Object.assign(httpError(403), { response: { status: 403, data: { error: { errors: [{ reason: 'userRateLimitExceeded' }] } } } });
    assert.equal(isRetryable(quota), true);
  });

  it('createLimiter never runs more than N tasks at once', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let max = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        limit(async () => {
          active += 1;
          max = Math.max(max, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
        }),
      ),
    );
    assert.equal(max, 2);
  });
});

describe('OAuth client', () => {
  /** @type {string} */
  let directory;
  before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'retreat-oauth-'));
  });
  after(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('requests only the gmail.readonly scope', () => {
    assert.deepEqual([...GMAIL_SCOPES], ['https://www.googleapis.com/auth/gmail.readonly']);
  });

  it('reports MAIL_SOURCE_NOT_CONFIGURED for missing or invalid credentials and tokens', async () => {
    await assert.rejects(readClientSecrets(join(directory, 'nope.json')), { code: 'MAIL_SOURCE_NOT_CONFIGURED' });
    const bad = join(directory, 'bad.json');
    await writeFile(bad, JSON.stringify({ something: true }));
    await assert.rejects(readClientSecrets(bad), { code: 'MAIL_SOURCE_NOT_CONFIGURED' });

    const credentialsPath = join(directory, 'credentials.json');
    await writeFile(credentialsPath, JSON.stringify({ installed: { client_id: 'id.apps.googleusercontent.com', client_secret: 'secret' } }));
    assert.deepEqual(await readClientSecrets(credentialsPath), { clientId: 'id.apps.googleusercontent.com', clientSecret: 'secret', type: 'installed' });
    await assert.rejects(
      loadAuthorizedClient({ credentialsPath, tokenPath: join(directory, 'missing-token.json'), logger: new NullLogger() }),
      (error) => {
        assert.equal(error.code, 'MAIL_SOURCE_NOT_CONFIGURED');
        assert.match(error.details.reason, /npm run auth/);
        return true;
      },
    );
  });

  it('persists refreshed tokens and keeps the refresh token', async () => {
    const credentialsPath = join(directory, 'credentials2.json');
    const tokenPath = join(directory, 'token.json');
    await writeFile(credentialsPath, JSON.stringify({ installed: { client_id: 'id', client_secret: 'secret' } }));
    await writeFile(tokenPath, JSON.stringify({ access_token: 'old', refresh_token: 'refresh-1', scope: GMAIL_SCOPES[0] }));
    const client = await loadAuthorizedClient({ credentialsPath, tokenPath, logger: new NullLogger() });
    client.emit('tokens', { access_token: 'new', expiry_date: 123 });
    let stored = {};
    for (let i = 0; i < 50; i += 1) {
      stored = JSON.parse(await readFile(tokenPath, 'utf8'));
      if (stored.access_token === 'new') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(stored.access_token, 'new');
    assert.equal(stored.refresh_token, 'refresh-1');
  });
});

describe('loopback authorization flow', () => {
  function fakeOAuthClient() {
    const captured = {};
    return {
      captured,
      client: /** @type {any} */ ({
        generateCodeVerifierAsync: async () => ({ codeVerifier: 'verifier', codeChallenge: 'challenge' }),
        generateAuthUrl: (options) => {
          Object.assign(captured, options);
          return 'https://accounts.example/consent';
        },
      }),
    };
  }

  it('builds a PKCE consent URL and resolves with the code returned on the loopback redirect', async () => {
    const { client, captured } = fakeOAuthClient();
    let printed = '';
    const flow = runLoopbackAuthorization({ oauthClient: client, onUrl: (url) => (printed = url), timeoutMs: 5000 });
    while (!captured.redirect_uri) await new Promise((resolve) => setTimeout(resolve, 5));

    assert.equal(printed, 'https://accounts.example/consent');
    assert.deepEqual(captured.scope, [...GMAIL_SCOPES]);
    assert.equal(captured.access_type, 'offline');
    assert.equal(captured.code_challenge_method, 'S256');
    assert.equal(captured.code_challenge, 'challenge');
    assert.match(captured.redirect_uri, /^http:\/\/127\.0\.0\.1:\d+\/oauth2callback$/);

    const response = await fetch(`${captured.redirect_uri}?state=${captured.state}&code=the-code`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Autorización completada/);
    assert.deepEqual(await flow, { code: 'the-code', codeVerifier: 'verifier', redirectUri: captured.redirect_uri });
  });

  it('rejects a redirect with a wrong state', async () => {
    const { client, captured } = fakeOAuthClient();
    const flow = runLoopbackAuthorization({ oauthClient: client, onUrl: () => {}, timeoutMs: 5000 });
    while (!captured.redirect_uri) await new Promise((resolve) => setTimeout(resolve, 5));
    const assertion = assert.rejects(flow, /state mismatch/);
    const response = await fetch(`${captured.redirect_uri}?state=forged&code=x`);
    assert.equal(response.status, 400);
    await assertion;
  });
});
