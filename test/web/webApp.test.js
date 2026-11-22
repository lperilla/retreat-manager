import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadConfig } from '../../src/composition/config.js';
import { createContainer } from '../../src/composition/container.js';
import { AppError } from '../../src/domain/errors.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { createWebApp, DEFAULT_RATE_LIMITS, PUBLIC_DIR } from '../../src/infrastructure/web/createWebApp.js';
import { WebRuntime } from '../../src/infrastructure/web/WebRuntime.js';
import { ScriptedMailSource, makeMessage } from '../helpers/applicationFakes.js';

/** @type {string} */
let exportDir;
const servers = [];

before(async () => {
  exportDir = await mkdtemp(join(tmpdir(), 'retreat-web-'));
});

after(async () => {
  for (const { server, runtime } of servers) {
    await new Promise((resolve) => server.close(resolve));
    await runtime.close();
  }
  await rm(exportDir, { recursive: true, force: true });
});

/**
 * Starts the real Express app on an ephemeral port.
 * @param {{ env?: Record<string, string>, accessToken?: string | null, rateLimits?: any, mailSource?: any, setup?: boolean }} [options]
 */
async function startApp({ env = {}, accessToken = null, rateLimits = DEFAULT_RATE_LIMITS, mailSource, setup = false } = {}) {
  const config = loadConfig({
    DEMO_MODE: setup ? 'false' : 'true',
    PERSISTENCE: 'json',
    SYNC_MIN_INTERVAL_SECONDS: '0',
    EXPORT_DIR: exportDir,
    CACHE_DIR: join(exportDir, 'cache'),
    DATA_DIR: join(exportDir, 'data'),
    TZ: 'Europe/Madrid',
    ...env,
  });
  const logger = new NullLogger();
  const runtime = await WebRuntime.create({
    config,
    logger,
    createContainer: (effective) => {
      if (setup && !effective.demoMode) throw new AppError('MAIL_SOURCE_NOT_CONFIGURED', 503);
      return createContainer({ config: effective, overrides: { logger, ...(mailSource ? { mailSource } : {}) } });
    },
  });
  const app = createWebApp({ runtime, logger, accessToken, rateLimits });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push({ server, runtime });
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const base = `http://127.0.0.1:${port}`;
  return {
    runtime,
    base,
    /** @param {string} path @param {RequestInit} [init] */
    fetch: (path, init = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init }),
    /** @param {string} path @param {unknown} body @param {Record<string, string>} [headers] */
    post: (path, body = {}, headers = {}) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
  };
}

/**
 * @param {{ fetch: (path: string) => Promise<Response> }} app
 */
async function waitForSync(app) {
  for (let i = 0; i < 50; i += 1) {
    const status = await (await app.fetch('/api/sync/status')).json();
    if (!status.running) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('sync did not finish');
}

describe('web security', () => {
  it('sends strict security headers (CSP without inline code, nosniff, no framing)', async () => {
    const app = await startApp();
    for (const path of ['/', '/api/app-info']) {
      const response = await app.fetch(path);
      const csp = response.headers.get('content-security-policy') ?? '';
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self'(;|$)/);
      assert.equal(csp.includes('unsafe-inline'), false);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
      assert.equal(response.headers.get('x-powered-by'), null);
    }
    assert.equal((await app.fetch('/api/app-info')).headers.get('cache-control'), 'no-store');
  });

  it('UI files contain no inline scripts, inline styles or innerHTML', async () => {
    for (const file of ['index.html', 'login.html']) {
      const html = await readFile(join(PUBLIC_DIR, file), 'utf8');
      assert.equal(/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), false, `${file} has an inline script`);
      assert.equal(/\sstyle=/i.test(html), false, `${file} has an inline style`);
      assert.equal(/\son[a-z]+=/i.test(html), false, `${file} has an inline event handler`);
    }
    for (const file of await readdir(join(PUBLIC_DIR, 'js'))) {
      const source = await readFile(join(PUBLIC_DIR, 'js', file), 'utf8');
      assert.equal(/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(source), false, `${file} writes raw HTML`);
    }
  });

  it('requires ACCESS_TOKEN when configured: 401 for the API, login sets an HttpOnly cookie, Bearer works', async () => {
    const token = 'token-de-prueba-muy-largo';
    const app = await startApp({ accessToken: token });

    const denied = await app.fetch('/api/dashboard');
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { code: 'UNAUTHORIZED', message: 'Acceso no autorizado. Introduce el código de acceso.' });
    assert.equal((await app.fetch('/')).headers.get('location'), '/login');
    assert.equal((await app.fetch('/print?participantIds=x')).status, 303);
    assert.equal((await app.fetch('/login')).status, 200);

    const form = (value) =>
      app.fetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `token=${encodeURIComponent(value)}` });
    assert.equal((await form('incorrecto')).headers.get('location'), '/login?error=1');

    const ok = await form(token);
    assert.equal(ok.headers.get('location'), '/');
    const cookie = ok.headers.get('set-cookie') ?? '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Strict/i);
    assert.equal(cookie.includes(token), false);

    const session = cookie.split(';')[0];
    assert.equal((await app.fetch('/api/dashboard', { headers: { Cookie: session } })).status, 200);
    assert.equal((await app.fetch('/api/dashboard', { headers: { Authorization: `Bearer ${token}` } })).status, 200);
    assert.equal((await app.fetch('/api/dashboard', { headers: { Authorization: 'Bearer otro' } })).status, 401);
    assert.equal((await app.fetch('/api/dashboard', { headers: { Cookie: 'retreat_session=forged' } })).status, 401);
  });

  it('rejects non-JSON mutations, malformed JSON and unknown API routes with { code, message }', async () => {
    const app = await startApp();
    const notJson = await app.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
    assert.equal(notJson.status, 415);
    assert.equal((await notJson.json()).code, 'UNSUPPORTED_MEDIA_TYPE');

    const malformed = await app.fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, 'VALIDATION_ERROR');

    const missing = await app.fetch('/api/nope');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { code: 'ROUTE_NOT_FOUND', message: 'Recurso no encontrado.' });
  });
});

describe('web API', () => {
  it('runs a sync in the background (202) and serves dashboard, participant and review data', async () => {
    const app = await startApp();
    const started = await app.post('/api/sync', { mode: 'incremental' });
    assert.equal(started.status, 202);
    assert.equal((await started.json()).accepted, true);
    const status = await waitForSync(app);
    assert.equal(status.lastResult.added, 23);

    const overview = await (await app.fetch('/api/dashboard')).json();
    assert.equal(overview.kpis.totalLetters, 23);
    assert.equal(overview.directory.rows.length, 18);

    const lucia = await (await app.fetch('/api/participants/lucia-fernandez/letters?afterDate=2026-11-18')).json();
    assert.deepEqual(lucia.letters.map((l) => l.messageId), ['demo-w1-08']);

    const unknown = await app.fetch('/api/participants/ghost/letters');
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { code: 'PARTICIPANT_NOT_FOUND', message: 'Participante no encontrado.' });

    const review = await (await app.fetch('/api/review')).json();
    assert.equal(review.total, 3);
    const assigned = await app.post('/api/review/demo-w1-03/assign', { participantIds: ['maria-lopez'] });
    assert.equal((await assigned.json()).assignment.manual, true);
    assert.equal((await (await app.fetch('/api/review')).json()).total, 2);

    const search = await (await app.fetch('/api/letters/search?q=croquetas')).json();
    assert.deepEqual(search.results.map((r) => r.messageId), ['demo-w1-02']);

    const fresh = await (await app.fetch('/api/letters/new')).json();
    assert.equal(fresh.total, 23);
    assert.equal((await (await app.post('/api/letters/seen', { participantId: 'juan-martinez' })).json()).updated, 2);

    const runs = await (await app.fetch('/api/sync/runs')).json();
    assert.equal(runs.runs[0].status, 'success');
  });

  it('manages rooms, tables and assignments through the accommodation API', async () => {
    const app = await startApp();
    const json = (/** @type {string} */ method, /** @type {any} */ body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const room = await app.post('/api/rooms', { name: 'Habitación 1', capacity: 1, accessible: true });
    assert.equal(room.status, 201);
    const roomId = (await room.json()).id;
    const table = await (await app.post('/api/tables', { name: 'Mesa 1', capacity: 6 })).json();
    const assigned = await app.fetch('/api/participants/lucia-fernandez/room', json('PUT', { roomId, bed: 'Cama 1' }));
    assert.equal(assigned.status, 200);
    assert.equal((await app.fetch('/api/participants/maria-garcia/room', json('PUT', { roomId }))).status, 409);
    await app.fetch('/api/participants/lucia-fernandez/table', json('PUT', { tableId: table.id }));
    const overview = await (await app.fetch('/api/accommodation')).json();
    assert.deepEqual(overview.byParticipant['lucia-fernandez'].room, { id: roomId, name: 'Habitación 1', bed: 'Cama 1' });
    assert.equal(overview.tables[0].occupancy, 1);
    assert.equal((await app.fetch(`/api/rooms/${roomId}`, json('DELETE', {}))).status, 409);
  });

  it('manages participants and the retreat through the participants module API', async () => {
    const app = await startApp();
    // Quick registration from the letters screen: name only, reported as incomplete.
    const quick = await app.post('/api/participants', { quick: true, givenNames: 'Luis', firstSurname: 'Perilla', aliases: ['Luisito'] });
    assert.equal(quick.status, 201);
    const created = (await quick.json()).participant;
    assert.equal(created.id, 'luis-perilla');
    assert.deepEqual(created.aliases, ['Luisito']);
    assert.equal(created.complete, false);

    const duplicate = await app.post('/api/participants', { quick: true, givenNames: 'luis', firstSurname: 'perilla' });
    assert.equal(duplicate.status, 409);
    assert.equal((await duplicate.json()).code, 'DUPLICATE_PARTICIPANT');
    const incomplete = await app.post('/api/participants', { givenNames: 'Ana', firstSurname: 'Ruiz' });
    assert.equal(incomplete.status, 400);
    assert.equal((await incomplete.json()).code, 'PARTICIPANT_INCOMPLETE');

    const edited = await app.fetch('/api/participants/luis-perilla', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ givenNames: 'Luis', firstSurname: 'Perilla', age: 40, emergencyContacts: [{ name: 'Ana', phone: '600123456' }] }),
    });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).participant.complete, true);

    const list = await (await app.fetch('/api/participants?filter=all&q=perilla')).json();
    assert.deepEqual(list.participants.map((/** @type {any} */ p) => p.id), ['luis-perilla']);
    const catalogs = await (await app.fetch('/api/catalogs')).json();
    assert.equal(catalogs.dietary.allergy.length, 15);

    const retreat = await (await app.fetch('/api/retreat', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Retiro de prueba', startDate: '2026-11-20', endDate: '2026-11-22' }),
    })).json();
    assert.equal(retreat.name, 'Retiro de prueba');
    assert.equal(retreat.retentionDays, 30);

    const deleted = await app.fetch('/api/participants/luis-perilla', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(deleted.status, 200);
    const review = await (await app.fetch('/api/review')).json();
    assert.ok(Array.isArray(review.unassigned.letters));
    assert.ok(Array.isArray(review.withdrawn.letters));
  });

  it('answers 429 with Retry-After during the cooldown and when the sync rate limit is exceeded', async () => {
    const cooled = await startApp({ env: { SYNC_MIN_INTERVAL_SECONDS: '30' } });
    assert.equal((await cooled.post('/api/sync', { mode: 'incremental' })).status, 202);
    await waitForSync(cooled);
    const refused = await cooled.post('/api/sync', { mode: 'incremental' });
    assert.equal(refused.status, 429);
    assert.equal((await refused.json()).code, 'SYNC_COOLDOWN');
    assert.ok(Number(refused.headers.get('retry-after')) > 0);

    const limited = await startApp({ rateLimits: { ...DEFAULT_RATE_LIMITS, sync: { windowMs: 60_000, max: 1 } } });
    assert.equal((await limited.post('/api/sync', { mode: 'incremental' })).status, 202);
    await waitForSync(limited);
    const blocked = await limited.post('/api/sync', { mode: 'incremental' });
    assert.equal(blocked.status, 429);
    assert.equal((await blocked.json()).code, 'RATE_LIMITED');
  });

  it('exports a batch, serves the download and refuses path traversal', async () => {
    const app = await startApp();
    await app.post('/api/sync', { mode: 'incremental' });
    await waitForSync(app);

    const created = await app.post('/api/exports', { participantIds: ['lucia-fernandez', 'hugo-serrano'], format: 'html' });
    assert.equal(created.status, 201);
    const result = await created.json();
    assert.match(result.filename, /^cartas_lote-2_\d{8}-\d{6}\.html$/);
    assert.equal('filePath' in result, false);

    const download = await app.fetch(result.downloadUrl);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') ?? '', /attachment/);
    const html = await download.text();
    assert.ok(html.includes('Lucía Fernández'));
    assert.ok(html.includes('page-break-before: always'));

    assert.equal((await app.post('/api/exports', { participantIds: ['lucia-fernandez'], format: 'docx' })).status, 400);
    assert.equal((await app.fetch('/api/exports/..%2F..%2Fpackage.json')).status, 400);
    const missing = await app.fetch('/api/exports/cartas_x_20260101-000000.html');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'EXPORT_NOT_FOUND');

    const marked = await app.post('/api/print-status', { participantIds: ['lucia-fernandez'], status: 'printed' });
    assert.equal((await marked.json()).statuses[0].status, 'printed');
  });

  it('renders the print view with escaped content and linked assets', async () => {
    const mailSource = new ScriptedMailSource(() => ({
      letters: [
        makeMessage({
          messageId: 'xss',
          subject: 'Carta para Lucía <script>alert(1)</script>',
          body: 'Querida Lucía:\n<img src=x onerror=alert(1)>',
        }),
      ],
      deletedMessageIds: [],
      nextCursor: 'c1',
    }));
    const app = await startApp({ mailSource });
    await app.post('/api/sync', { mode: 'incremental' });
    await waitForSync(app);

    const response = await app.fetch('/print?participantIds=lucia-fernandez');
    assert.equal(response.status, 200);
    // Only the print view accepts inline style attributes (the sender's formatting).
    assert.match(response.headers.get('content-security-policy') ?? '', /style-src-attr 'unsafe-inline'/);
    assert.doesNotMatch((await app.fetch('/')).headers.get('content-security-policy') ?? '', /unsafe-inline/);
    const html = await response.text();
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('<img src=x'), false);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('href="/css/packet.css"'));

    const css = await app.fetch('/css/packet.css');
    assert.match(css.headers.get('content-type') ?? '', /text\/css/);

    const empty = await app.fetch('/print');
    assert.equal(empty.status, 400);
    assert.match(await empty.text(), /Selecciona al menos un participante/);
  });
});

describe('attachments', () => {
  it('serves thumbnails, PDFs, DOCX text and downloads with safe headers', async () => {
    const app = await startApp();
    await app.post('/api/sync', { mode: 'incremental' });
    await waitForSync(app);

    const lucia = await (await app.fetch('/api/participants/javier-moreno/letters')).json();
    const scan = lucia.letters[0].attachments[0];
    assert.deepEqual({ kind: scan.kind, index: scan.index, inline: scan.inline }, { kind: 'image', index: 0, inline: false });
    assert.equal('attachmentId' in scan, false);

    const thumb = await app.fetch('/api/letters/demo-w1-12/attachments/0?variant=thumbnail');
    assert.equal(thumb.status, 200);
    assert.equal(thumb.headers.get('content-type'), 'image/jpeg');
    assert.match(thumb.headers.get('content-disposition') ?? '', /^inline/);
    assert.match(thumb.headers.get('content-security-policy') ?? '', /sandbox/);
    assert.ok((await thumb.arrayBuffer()).byteLength > 1000);

    const pdf = await app.fetch('/api/letters/demo-w1-13/attachments/0');
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(pdf.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.match(pdf.headers.get('content-security-policy') ?? '', /frame-ancestors 'self'/);

    const text = await (await app.fetch('/api/letters/demo-w1-14/attachments/0/text')).json();
    assert.match(text.text, /^Querido Diego:/);

    const docx = await app.fetch('/api/letters/demo-w1-14/attachments/0');
    assert.match(docx.headers.get('content-disposition') ?? '', /^attachment/);

    const mov = await app.fetch('/api/letters/demo-w1-15/attachments/0');
    assert.equal(mov.headers.get('content-type'), 'application/octet-stream');
    assert.match(mov.headers.get('content-disposition') ?? '', /^attachment; filename="?video-familia\.mov"?/);

    const missing = await app.fetch('/api/letters/demo-w1-15/attachments/7');
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'ATTACHMENT_NOT_FOUND');
    assert.equal((await app.fetch('/api/letters/demo-w1-15/attachments/0?variant=huge')).status, 400);
    assert.equal((await (await app.fetch('/api/letters/demo-w1-13/attachments/0?variant=display')).json()).code, 'ATTACHMENT_NOT_PROCESSABLE');
  });

  it('embeds attachments in HTML exports by default and links them in the print view', async () => {
    const app = await startApp();
    await app.post('/api/sync', { mode: 'incremental' });
    await waitForSync(app);

    const withAttachments = await (await app.post('/api/exports', { participantIds: ['javier-moreno', 'diego-navarro'], format: 'html' })).json();
    const html = await (await app.fetch(withAttachments.downloadUrl)).text();
    assert.match(html, /data:image\/jpeg;base64,/);
    assert.match(html, /Documento adjunto: Carta Diego\.docx/);

    const without = await (await app.post('/api/exports', { participantIds: ['javier-moreno'], format: 'html', includeAttachments: false })).json();
    assert.equal((await (await app.fetch(without.downloadUrl)).text()).includes('data:image'), false);

    const print = await (await app.fetch('/print?participantIds=maria-garcia')).text();
    assert.ok(print.includes('<img src="/api/letters/demo-w1-23/attachments/0?variant=display"'));
    assert.equal(print.includes('[cid:perro@demo]'), false);

    const info = await (await app.fetch('/api/app-info')).json();
    assert.equal(info.attachmentsAvailable, true);
    assert.equal(info.maxAttachmentMb, 15);
  });
});

describe('setup mode', () => {
  it('answers 503 until demo mode is enabled from the UI', async () => {
    const app = await startApp({ setup: true });
    const info = await (await app.fetch('/api/app-info')).json();
    assert.equal(info.setupRequired, true);

    const blocked = await app.fetch('/api/dashboard');
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).code, 'MAIL_SOURCE_NOT_CONFIGURED');

    const enabled = await (await app.post('/api/demo/enable')).json();
    assert.equal(enabled.setupRequired, false);
    assert.equal(enabled.demoMode, true);
    assert.deepEqual(enabled.exportFormats, ['html', 'txt', 'json', 'pdf']);
    assert.equal((await app.fetch('/api/dashboard')).status, 200);
  });
});
