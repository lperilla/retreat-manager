#!/usr/bin/env node
/**
 * Creates the test-letter set directly in the authorized Gmail mailbox (development tool).
 *
 *   node scripts/seed-gmail.js --dry-run              build the letters as .eml files in .run/seed/ (no Gmail)
 *   node scripts/seed-gmail.js                        insert them into Gmail (asks for confirmation)
 *   node scripts/seed-gmail.js --write-participants   also write data/participants.json (backup in .run/)
 *   node scripts/seed-gmail.js --load-participants    also REPLACE the participants of the active retreat in the
 *                                                     configured store (MongoDB) with the test participants and
 *                                                     their full profiles (backup in .run/). With --dry-run it
 *                                                     only loads the participants: Gmail is not touched.
 *   node scripts/seed-gmail.js --generated            instead of the fixed catalog, ~100 letters of varied
 *                                                     complexity generated for the participants ALREADY in the
 *                                                     active retreat (read-only; --generated=150 for another
 *                                                     amount). Combine with --dry-run to only build the .eml files.
 *                                                     Each run uses a new random seed (new letters); --seed=N
 *                                                     repeats the set of a previous run.
 *
 * - Uses `users.messages.insert` (nothing is sent; messages appear in the inbox as unread,
 *   with the dates of the catalog).
 * - Requests ONLY the `gmail.insert` scope (plus openid/email to verify the account) and keeps
 *   that token apart in .run/seed-token.json; the application's token.json stays read-only.
 * - Refuses to insert if the insert authorization and token.json belong to different accounts.
 * - All senders use @familias-prueba.example: select them with GMAIL_QUERY=from:familias-prueba.example
 *   and delete them from Gmail with the same search.
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { createPersistenceAdapters } from '../src/composition/container.js';
import { loadEnvironment, PROJECT_ROOT } from '../src/entrypoints/bootstrap.js';
import { SystemClock } from '../src/infrastructure/clock/SystemClock.js';
import { createGmailClient, OAuth2 } from '../src/infrastructure/gmail/googleClient.js';
import { loadAuthorizedClient, readClientSecrets, writeTokenFile } from '../src/infrastructure/gmail/oauthClient.js';
import { runLoopbackAuthorization } from '../src/infrastructure/gmail/oauthFlow.js';
import { withRetry } from '../src/infrastructure/gmail/retry.js';
import { NullLogger } from '../src/infrastructure/logging/NullLogger.js';
import { SEED_LETTERS, SEED_PARTICIPANTS, SEED_QUERY, resolveDate } from './seed/catalog.js';
import { generateLetters } from './seed/generated.js';
import { currentParticipants, loadSeedParticipants } from './seed/loadParticipants.js';
import { buildMime } from './seed/mime.js';

const INSERT_SCOPES = Object.freeze(['https://www.googleapis.com/auth/gmail.insert', 'openid', 'email']);
const RUN_DIR = join(PROJECT_ROOT, '.run');
const SEED_TOKEN = join(RUN_DIR, 'seed-token.json');

const say = (/** @type {string} */ text) => process.stdout.write(`${text}\n`);

/** @param {string} url */
function openBrowser(url) {
  const [file, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    const child = spawn(file, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed anyway.
  }
}

/**
 * Decodes the e-mail claim of a Google ID token (only used to compare accounts).
 * @param {string | null | undefined} idToken
 */
function emailFromIdToken(idToken) {
  if (!idToken) return null;
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')).email ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {Date} now
 * @param {string} toAddress
 * @param {readonly import('./seed/catalog.js').SeedLetter[]} letters
 */
async function buildMessages(now, toAddress, letters) {
  const messages = [];
  for (const letter of letters) {
    const attachments = letter.attachments ? await letter.attachments() : [];
    const raw = buildMime({
      from: letter.from,
      to: { name: 'Cartas del retiro', address: toAddress },
      subject: letter.subject,
      date: resolveDate(letter.when, now),
      text: letter.text,
      textCharset: letter.textCharset,
      html: letter.html,
      headers: letter.headers,
      attachments,
      messageId: `seed-${letter.id}-${now.getTime()}@familias-prueba.example`,
    });
    messages.push({ letter, raw, attachments });
  }
  return messages;
}

/**
 * @param {import('../src/composition/config.js').AppConfig} config
 */
async function insertAuthorization(config) {
  const secrets = await readClientSecrets(config.gmail.credentialsPath);
  const client = new OAuth2(secrets.clientId, secrets.clientSecret);
  if (existsSync(SEED_TOKEN)) {
    const tokens = JSON.parse(readFileSync(SEED_TOKEN, 'utf8'));
    if (!String(tokens.scope ?? '').split(/\s+/).includes(INSERT_SCOPES[0])) {
      rmSync(SEED_TOKEN, { force: true });
      return insertAuthorization(config);
    }
    client.setCredentials(tokens);
    client.on('tokens', (fresh) => writeTokenFile(SEED_TOKEN, { ...tokens, ...fresh, refresh_token: fresh.refresh_token ?? tokens.refresh_token }));
    return { client, email: emailFromIdToken(tokens.id_token) };
  }
  say('\nSe necesita un permiso adicional SOLO para insertar correos de prueba (gmail.insert).');
  say('Se guarda aparte (.run/seed-token.json); el token de la aplicación sigue siendo de solo lectura.');
  const { code, codeVerifier, redirectUri } = await runLoopbackAuthorization({
    oauthClient: client,
    scopes: INSERT_SCOPES,
    openUrl: openBrowser,
    onUrl: (url) => say(`\nAbre esta dirección y elige la MISMA cuenta del buzón:\n\n${url}\n\nEsperando la autorización (5 minutos)…`),
  });
  const { tokens } = await client.getToken({ code, codeVerifier, redirect_uri: redirectUri });
  const granted = String(tokens.scope ?? '').split(/\s+/);
  if (!granted.includes(INSERT_SCOPES[0])) {
    throw new Error(
      'Google no ha concedido el permiso para insertar correos. En la pantalla de permisos marca la casilla «Insertar correo en tu buzón de Gmail» (o «Seleccionar todo») y vuelve a ejecutar el script. Si la casilla no aparece, añade el permiso https://www.googleapis.com/auth/gmail.insert en Google Cloud → Google Auth Platform → Acceso a los datos.',
    );
  }
  mkdirSync(RUN_DIR, { recursive: true });
  await writeTokenFile(SEED_TOKEN, /** @type {Record<string, unknown>} */ (tokens));
  client.setCredentials(tokens);
  return { client, email: emailFromIdToken(tokens.id_token) };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const generatedArg = [...args].find((arg) => arg === '--generated' || arg.startsWith('--generated='));
  const seedArg = [...args].find((arg) => arg.startsWith('--seed='));
  const unknown = [...args].filter((arg) => arg !== generatedArg && arg !== seedArg && !['--dry-run', '--yes', '--write-participants', '--load-participants'].includes(arg));
  if (unknown.length > 0) throw new Error(`Opción desconocida: ${unknown.join(', ')}`);

  const config = loadEnvironment();
  const now = new Date();
  const loadParticipants = args.has('--load-participants');
  if (loadParticipants && config.demoMode) throw new Error('--load-participants necesita DEMO_MODE=false (en el modo demo los participantes son los de ejemplo).');
  if (generatedArg && loadParticipants) throw new Error('--generated escribe a los participantes que ya hay: no se combina con --load-participants.');

  /** @type {readonly import('./seed/catalog.js').SeedLetter[]} */
  let letters = SEED_LETTERS;
  if (generatedArg) {
    const count = generatedArg.includes('=') ? Number(generatedArg.split('=')[1]) : 100;
    if (!Number.isInteger(count) || count < 20 || count > 500) throw new Error('--generated=N: N entre 20 y 500.');
    // A different seed on every run gives a new set of letters; --seed=N repeats a set.
    const seed = seedArg ? Number(seedArg.split('=')[1]) : now.getTime() % 2_147_483_647;
    if (!Number.isInteger(seed) || seed < 0) throw new Error('--seed=N: N debe ser un número entero positivo.');
    const { retreat, participants } = await withStore(config, (persistence) => currentParticipants({ persistence, now }));
    letters = await generateLetters(participants, { count, seed });
    say(`Cartas generadas para los ${participants.length} participantes del retiro «${retreat.name}» (no se cambia ningún participante; semilla ${seed}).`);
  }

  if (args.has('--dry-run')) {
    const messages = await buildMessages(now, 'buzon-de-prueba@example.com', letters);
    const dir = join(RUN_DIR, 'seed');
    mkdirSync(dir, { recursive: true });
    for (const [index, { letter, raw }] of messages.entries()) {
      writeFileSync(join(dir, `${String(index + 1).padStart(2, '0')}-${letter.id}.eml`), raw);
    }
    printSummary(messages);
    say(`\n${messages.length} correos generados en ${dir} (puedes abrirlos con Outlook o Thunderbird). No se ha tocado Gmail.`);
    if (loadParticipants) {
      say(`\n${await describeReplacement(config, now)}`);
      if (args.has('--yes') || (await confirm())) await replaceParticipants(config, now);
      else say('Cancelado: no se ha cambiado ningún participante.');
    }
    return;
  }

  // Account of the application (read-only token) = destination mailbox.
  const reader = await loadAuthorizedClient({ credentialsPath: config.gmail.credentialsPath, tokenPath: config.gmail.tokenPath, logger: new NullLogger() });
  const profile = await createGmailClient(reader).users.getProfile({ userId: 'me' });
  const mailbox = String(profile.data.emailAddress ?? '');
  if (!mailbox) throw new Error('No se pudo leer la dirección del buzón con token.json.');

  const { client, email } = await insertAuthorization(config);
  if (!email || email.toLowerCase() !== mailbox.toLowerCase()) {
    throw new Error(
      `La autorización para insertar es de ${email ?? 'una cuenta desconocida'}, pero el buzón de la aplicación es ${mailbox}. Borra .run/seed-token.json y vuelve a autorizar con la cuenta correcta.`,
    );
  }

  const messages = await buildMessages(now, mailbox, letters);
  printSummary(messages);
  say(`\nSe van a crear ${messages.length} correos de prueba en la bandeja de entrada de ${mailbox}.`);
  say('No se envía nada a nadie; los remitentes son ficticios (@familias-prueba.example).');
  if (loadParticipants) say(await describeReplacement(config, now));
  if (!args.has('--yes') && !(await confirm())) {
    say(`Cancelado: no se ha creado ningún correo${loadParticipants ? ' ni se ha cambiado ningún participante' : ''}.`);
    return;
  }

  const gmail = createGmailClient(client);
  let created = 0;
  for (const { letter, raw } of messages) {
    await withRetry(() =>
      gmail.users.messages.insert({
        userId: 'me',
        internalDateSource: 'dateHeader',
        requestBody: { raw: raw.toString('base64url'), labelIds: ['INBOX', 'UNREAD'] },
      }),
    );
    created += 1;
    process.stdout.write(`\r  creados ${created}/${messages.length}  (${letter.id})${' '.repeat(20)}`);
  }
  say('\n');
  say(`✔ ${created} correos de prueba creados en ${mailbox}.`);

  if (args.has('--write-participants')) writeParticipants();
  if (loadParticipants) await replaceParticipants(config, now);

  say('\nSiguientes pasos:');
  say(`  1. En .env pon: GMAIL_QUERY=${SEED_QUERY}`);
  say('  2. Reinicia el panel: .\\start.cmd --restart   y pulsa «Sincronización completa».');
  say(`  3. Para borrarlos de Gmail: busca «${SEED_QUERY}», selecciona todos y elimínalos.`);
}

/** Asks for an explicit "SI" (end of input counts as no). */
async function confirm() {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    prompt.once('close', () => resolve(''));
    prompt.question('Escribe SI para continuar: ').then(resolve, () => resolve(''));
  });
  prompt.close();
  return String(answer).trim().toUpperCase() === 'SI';
}

/**
 * @template T
 * @param {import('../src/composition/config.js').AppConfig} config
 * @param {(persistence: any) => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withStore(config, work) {
  const persistence = await createPersistenceAdapters({ config, clock: new SystemClock(), logger: new NullLogger() });
  try {
    return await work(persistence);
  } finally {
    await persistence.close();
  }
}

/**
 * What --load-participants is going to change (shown before the confirmation).
 * @param {import('../src/composition/config.js').AppConfig} config
 * @param {Date} now
 */
async function describeReplacement(config, now) {
  const { retreat, participants } = await withStore(config, (persistence) => currentParticipants({ persistence, now }));
  return [
    `Se van a SUSTITUIR los ${participants.length} participantes del retiro «${retreat.name}» por los ${SEED_PARTICIPANTS.length} de prueba (con ficha completa y nacionalidad).`,
    'Los que no estén en la lista de prueba se borran y se liberan su habitación y su mesa. Antes se guarda una copia en .run/.',
  ].join('\n');
}

/**
 * Backs up the active retreat's participants, then loads the test participants.
 * @param {import('../src/composition/config.js').AppConfig} config
 * @param {Date} now
 */
async function replaceParticipants(config, now) {
  await withStore(config, async (persistence) => {
    const { participants } = await currentParticipants({ persistence, now });
    mkdirSync(RUN_DIR, { recursive: true });
    const backup = join(RUN_DIR, `participants-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(backup, `${JSON.stringify(participants, null, 2)}\n`);
    const { loaded, removed } = await loadSeedParticipants({ persistence, now });
    say(`✔ ${loaded} participantes de prueba cargados (${removed.length} quitados). Copia de los anteriores: ${backup}`);
  });
}

function writeParticipants() {
  const file = join(PROJECT_ROOT, 'data', 'participants.json');
  mkdirSync(join(PROJECT_ROOT, 'data'), { recursive: true });
  if (existsSync(file)) {
    mkdirSync(RUN_DIR, { recursive: true });
    copyFileSync(file, join(RUN_DIR, 'participants.backup.json'));
  }
  const names = SEED_PARTICIPANTS.map(({ displayName, aliases }) => ({ displayName, aliases }));
  writeFileSync(file, `${JSON.stringify(names, null, 2)}\n`);
  say(`✔ data/participants.json actualizado con los ${SEED_PARTICIPANTS.length} participantes de prueba (copia del anterior en .run/participants.backup.json).`);
}

/**
 * @param {Array<{ letter: import('./seed/catalog.js').SeedLetter, attachments: Array<{ filename: string }> }>} messages
 */
function printSummary(messages) {
  say('\nCartas de prueba:');
  for (const [index, { letter, attachments }] of messages.entries()) {
    const expected =
      letter.expect.status === 'ASSIGNED' ? `→ ${letter.expect.participants?.join(', ')}` : letter.tests.includes('Por revisar') ? '' : '→ Por revisar';
    const files = attachments.length > 0 ? ` [${attachments.map((a) => a.filename).join(', ')}]` : '';
    say(`  ${String(index + 1).padStart(2, ' ')}. ${letter.tests} ${expected}${files}`);
  }
}

main().catch((error) => {
  const details = /** @type {{ details?: unknown }} */ (error)?.details;
  process.stderr.write(`✖ ${error?.message ?? error}${details ? ` ${JSON.stringify(details)}` : ''}\n`);
  process.exit(1);
});
