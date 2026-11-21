#!/usr/bin/env node
/**
 * Process manager for the dashboard (used by ./start.sh and start.cmd):
 *
 *   install   check Node, npm ci, create .env (random MongoDB password) and data/participants.json
 *   start     (default) start MongoDB if needed + the web server in the background, wait until healthy
 *   stop      stop the web server (and the local MongoDB container unless --keep-mongo)
 *   restart   stop + start (MongoDB keeps running)
 *   status    show what is running, URLs and configuration warnings
 *   logs      show the last lines of the web log (--follow to keep watching)
 *   auth      run the Gmail OAuth consent flow (npm run auth)
 *
 * Commands can be given as words or flags: `./start.sh --stop` == `./start.sh stop`.
 * Works before `npm ci` (only Node built-ins and dependency-free project modules are imported).
 * User-facing output is in Spanish.
 */
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { loadConfig } from '../src/composition/config.js';
import { isLoopbackHost, listAccessUrls } from '../src/infrastructure/web/security/networkSecurity.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIN_NODE_MAJOR = 22;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const COMMANDS = ['install', 'start', 'stop', 'restart', 'status', 'logs', 'auth', 'help'];

/**
 * @typedef {Object} Options
 * @property {string}  command
 * @property {boolean} demo
 * @property {boolean} open
 * @property {boolean} mongo      Manage the local MongoDB container.
 * @property {boolean} keepMongo  `stop`: leave MongoDB running.
 * @property {boolean} follow
 * @property {boolean} force
 * @property {number}  lines
 */

/**
 * @param {string[]} argv
 * @returns {Options}
 */
export function parseArgs(argv) {
  /** @type {Options} */
  const options = { command: 'start', demo: false, open: true, mongo: true, keepMongo: false, follow: false, force: false, lines: 60 };
  let commandSet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const word = arg.replace(/^--?/, '').toLowerCase();
    if (COMMANDS.includes(word) || word === 'h') {
      if (commandSet) throw new UsageError(`Solo se puede indicar una acción (recibido «${arg}» además de «${options.command}»).`);
      options.command = word === 'h' ? 'help' : word;
      commandSet = true;
    } else if (word === 'demo') options.demo = true;
    else if (word === 'no-open') options.open = false;
    else if (word === 'no-mongo') options.mongo = false;
    else if (word === 'keep-mongo') options.keepMongo = true;
    else if (word === 'follow' || word === 'f') options.follow = true;
    else if (word === 'force') options.force = true;
    else if (word === 'lines' || word === 'n') {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) throw new UsageError('--lines necesita un número positivo.');
      options.lines = value;
      i += 1;
    } else {
      throw new UsageError(`Opción desconocida: «${arg}». Usa --help para ver las opciones.`);
    }
  }
  return options;
}

export class UsageError extends Error {}

export const HELP = `Cartas del retiro: gestión del panel

Uso:  ./start.sh [acción] [opciones]        (Linux, macOS, Git Bash)
      .\\start.cmd [acción] [opciones]       (Windows: PowerShell o cmd)

Acciones:
  (ninguna) | --start   Arranca el panel en segundo plano (y MongoDB si hace falta)
  --install             Instala dependencias y prepara .env y data/participants.json
  --stop                Para el panel y el contenedor de MongoDB (los datos se conservan)
  --restart             Reinicia el panel (MongoDB sigue en marcha)
  --status              Muestra qué está en marcha, las direcciones y avisos de configuración
  --logs                Muestra el registro del panel (--follow para seguirlo, --lines N)
  --auth                Autoriza el acceso de solo lectura a Gmail (escribe token.json)
  --help                Muestra esta ayuda

Opciones:
  --demo                Arranca en modo demostración (datos ficticios en memoria)
  --no-open             No abre el navegador al arrancar
  --no-mongo            No gestiona el contenedor de MongoDB
  --keep-mongo          Con --stop: deja MongoDB en marcha
  --force               Con --stop: para el proceso aunque no responda
`;

// ---------------------------------------------------------------------------
// Environment and configuration (no external dependencies)
// ---------------------------------------------------------------------------

/**
 * Minimal .env parser (KEY=VALUE, comments, optional quotes).
 * @param {string} text
 * @returns {Record<string, string>}
 */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

/**
 * .env content from .env.example with a freshly generated MongoDB password (hex: no URL
 * encoding needed), used consistently by docker-compose and MONGODB_URI.
 * @param {string} example
 * @param {() => string} [generatePassword]
 * @returns {string}
 */
export function buildEnvFile(example, generatePassword = () => randomBytes(18).toString('hex')) {
  const password = generatePassword();
  return example
    .replace(/^MONGO_ROOT_PASSWORD=.*$/m, `MONGO_ROOT_PASSWORD=${password}`)
    .replace(/^(MONGODB_URI=mongodb:\/\/[^:]+:)[^@]*(@.*)$/m, `$1${password}$2`);
}

/** @param {NodeJS.ProcessEnv} env */
function envFilePath(env = process.env) {
  return env.RETREAT_ENV_FILE ? resolve(env.RETREAT_ENV_FILE) : join(ROOT, '.env');
}

/** @param {NodeJS.ProcessEnv} env */
function runDir(env = process.env) {
  return env.RETREAT_RUN_DIR ? resolve(env.RETREAT_RUN_DIR) : join(ROOT, '.run');
}

/**
 * Effective environment: .env values overridden by real environment variables.
 * @param {Options} options
 */
function effectiveEnv(options) {
  const file = envFilePath();
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  /** @type {Record<string, string | undefined>} */
  const env = { ...fromFile, ...process.env };
  if (options.demo) env.DEMO_MODE = 'true';
  return env;
}

/**
 * @param {Options} options
 */
function readConfig(options) {
  const env = effectiveEnv(options);
  return { env, config: loadConfig(env, { rootDir: ROOT }) };
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
/** @param {string} code @param {string} text */
const paint = (code, text) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);
const out = {
  info: (/** @type {string} */ text) => process.stdout.write(`${text}\n`),
  ok: (/** @type {string} */ text) => process.stdout.write(`${paint('32', '✔')} ${text}\n`),
  warn: (/** @type {string} */ text) => process.stdout.write(`${paint('33', '!')} ${text}\n`),
  fail: (/** @type {string} */ text) => process.stderr.write(`${paint('31', '✖')} ${text}\n`),
  step: (/** @type {string} */ text) => process.stdout.write(`${paint('36', '→')} ${text}\n`),
};

// ---------------------------------------------------------------------------
// Processes
// ---------------------------------------------------------------------------

/**
 * @param {number} pid
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/**
 * @typedef {{ pid: number, port: number, host: string, demo: boolean, startedAt: string }} RunInfo
 */

/** @returns {RunInfo | null} */
function readRunInfo() {
  const file = join(runDir(), 'web.json');
  try {
    const info = JSON.parse(readFileSync(file, 'utf8'));
    return Number.isInteger(info.pid) ? info : null;
  } catch {
    return null;
  }
}

/** @param {RunInfo} info */
function writeRunInfo(info) {
  mkdirSync(runDir(), { recursive: true });
  writeFileSync(join(runDir(), 'web.json'), `${JSON.stringify(info, null, 2)}\n`);
}

function clearRunInfo() {
  rmSync(join(runDir(), 'web.json'), { force: true });
}

/**
 * Address to probe locally for a configured HOST.
 * @param {string} host
 */
function probeHost(host) {
  if (!host || host === '0.0.0.0' || host === '::') return '127.0.0.1';
  return host.replace(/^\[|\]$/g, '');
}

/**
 * @param {string} host
 * @param {number} port
 * @param {string | null} token
 * @returns {Promise<any | null>}
 */
async function fetchJson(host, port, path, token) {
  const target = probeHost(host);
  const url = `http://${target.includes(':') ? `[${target}]` : target}:${port}${path}`;
  try {
    const response = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(2000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} host
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function portInUse(host, port) {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: probeHost(host), port });
    socket.setTimeout(1000);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolvePromise(false);
    });
    socket.once('error', () => resolvePromise(false));
  });
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ inherit?: boolean, shell?: boolean, env?: Record<string, string | undefined> }} [options]
 */
function run(command, args, { inherit = false, shell = false, env } = {}) {
  const result = spawnSync(shell ? [command, ...args].join(' ') : command, shell ? [] : args, {
    cwd: ROOT,
    stdio: inherit ? 'inherit' : 'pipe',
    encoding: 'utf8',
    shell,
    env: env ? /** @type {NodeJS.ProcessEnv} */ (env) : process.env,
    windowsHide: true,
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error };
}

/** @param {string} url */
function openBrowser(url) {
  const [file, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(file, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // Opening the browser is a convenience only.
  }
}

// ---------------------------------------------------------------------------
// MongoDB (docker-compose.yml)
// ---------------------------------------------------------------------------

/** @returns {string[] | null}  e.g. ['docker', 'compose'] or ['podman', 'compose'] */
function composeCommand() {
  for (const engine of ['docker', 'podman']) {
    if (run(engine, ['compose', 'version']).status === 0) return [engine, 'compose'];
  }
  return null;
}

/**
 * The local container is managed only for PERSISTENCE=mongo on a loopback MONGODB_URI.
 * @param {ReturnType<typeof loadConfig>} config
 * @param {Options} options
 */
function managesMongo(config, options) {
  if (!options.mongo || config.demoMode || config.persistence !== 'mongo') return false;
  if (!existsSync(join(ROOT, 'docker-compose.yml'))) return false;
  const host = /^mongodb:\/\/(?:[^@/]*@)?([^/:?,]+)/i.exec(config.mongo.uri)?.[1] ?? '';
  return isLoopbackHost(host);
}

/**
 * @param {Record<string, string | undefined>} env
 */
function startMongo(env) {
  const compose = composeCommand();
  if (!compose) {
    throw new Error('PERSISTENCE=mongo necesita Docker o Podman con Compose (o usa PERSISTENCE=json, o --no-mongo si MongoDB ya está en marcha).');
  }
  out.step(`Arrancando MongoDB (${compose.join(' ')})…`);
  const result = run(compose[0], [compose[1], 'up', '-d', '--wait'], { env });
  if (result.status !== 0) {
    throw new Error(`No se pudo arrancar MongoDB:\n${(result.stderr || result.stdout).trim()}`);
  }
  out.ok('MongoDB en marcha (127.0.0.1, con autenticación).');
}

/**
 * @param {Record<string, string | undefined>} env
 */
function stopMongo(env) {
  const compose = composeCommand();
  if (!compose) return;
  const result = run(compose[0], [compose[1], 'stop'], { env });
  if (result.status === 0) out.ok('MongoDB parado (los datos se conservan en el volumen).');
  else out.warn(`No se pudo parar MongoDB: ${(result.stderr || result.stdout).trim()}`);
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
function mongoState(env) {
  const compose = composeCommand();
  if (!compose) return 'sin Docker/Podman';
  const result = run(compose[0], [compose[1], 'ps', '--all', '--format', '{{.Name}} {{.State}} {{.Status}}'], { env });
  const line = result.stdout.split('\n').find((l) => l.trim());
  return line ? line.trim() : 'no creado';
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < MIN_NODE_MAJOR) {
    throw new Error(`Se necesita Node.js ${MIN_NODE_MAJOR} o superior (tienes ${process.versions.node}).`);
  }
}

/** Creates .env and data/participants.json when missing. */
function prepareFiles() {
  const envFile = envFilePath();
  if (!existsSync(envFile)) {
    writeFileSync(envFile, buildEnvFile(readFileSync(join(ROOT, '.env.example'), 'utf8')));
    out.ok(`Creado ${envFile} a partir de .env.example (con una contraseña de MongoDB aleatoria). Revísalo.`);
  }
  const participants = join(ROOT, 'data', 'participants.json');
  if (!existsSync(participants) && !process.env.PARTICIPANTS_FILE) {
    mkdirSync(join(ROOT, 'data'), { recursive: true });
    writeFileSync(participants, readFileSync(join(ROOT, 'participants.example.json')));
    out.ok('Creado data/participants.json con participantes de ejemplo. Sustitúyelos por los reales.');
  }
}

/**
 * @param {Options} options
 */
async function install(options) {
  checkNode();
  out.ok(`Node.js ${process.versions.node}`);
  const hasLock = existsSync(join(ROOT, 'package-lock.json'));
  out.step(hasLock ? 'Instalando dependencias (npm ci)…' : 'Instalando dependencias (npm install)…');
  const npm = run('npm', [hasLock ? 'ci' : 'install', '--no-audit', '--no-fund'], { inherit: true, shell: process.platform === 'win32' });
  if (npm.status !== 0) throw new Error('La instalación de dependencias ha fallado (mira el mensaje de npm).');
  out.ok('Dependencias instaladas.');
  prepareFiles();

  const { config } = readConfig(options);
  if (managesMongo(config, options)) {
    const compose = composeCommand();
    if (compose) out.ok(`MongoDB se gestionará con ${compose.join(' ')} (docker-compose.yml).`);
    else out.warn('PERSISTENCE=mongo pero no hay Docker ni Podman: instálalos o usa PERSISTENCE=json en .env.');
  }
  reportGmail(config);
  out.info(`\nSiguiente paso: ${process.platform === 'win32' ? '.\\start.cmd' : './start.sh'}   (o con --demo para probar sin Gmail)`);
}

/**
 * @param {ReturnType<typeof loadConfig>} config
 */
function reportGmail(config) {
  if (config.demoMode) return;
  const credentials = existsSync(config.gmail.credentialsPath);
  const token = existsSync(config.gmail.tokenPath);
  if (credentials && token) out.ok('Gmail configurado (credentials.json y token.json).');
  else if (credentials) out.warn('Falta token.json: ejecuta la acción --auth para autorizar Gmail.');
  else out.warn('Falta credentials.json (Google Cloud → cliente OAuth «Aplicación de escritorio»). Sin él, el panel ofrece el modo demostración.');
  if (!config.gmail.query && !config.gmail.labelId) {
    out.warn('GMAIL_QUERY está vacío: se tomarán como cartas todos los correos recibidos en el buzón (salvo spam, papelera, borradores y enviados). Úsalo solo con un buzón dedicado.');
  }
}

/**
 * @param {Options} options
 */
async function start(options) {
  checkNode();
  if (!existsSync(join(ROOT, 'node_modules'))) {
    out.step('Primera ejecución: instalando…');
    await install(options);
  }
  prepareFiles();
  const { env, config } = readConfig(options);
  const token = config.accessToken;

  const current = readRunInfo();
  if (current && isAlive(current.pid)) {
    out.ok(`El panel ya está en marcha (PID ${current.pid}).`);
    printUrls(config);
    return;
  }
  if (current) clearRunInfo();
  if (await portInUse(config.host, config.port)) {
    throw new Error(`El puerto ${config.port} ya está ocupado por otro programa. Cambia PORT en .env o para ese programa.`);
  }

  if (managesMongo(config, options)) startMongo(env);

  mkdirSync(runDir(), { recursive: true });
  const logFile = join(runDir(), 'web.log');
  const logFd = openSync(logFile, 'a');
  out.step(options.demo || config.demoMode ? 'Arrancando el panel en modo demostración…' : 'Arrancando el panel…');
  const child = spawn(process.execPath, [join(ROOT, 'src', 'entrypoints', 'web.js')], {
    cwd: ROOT,
    env: /** @type {NodeJS.ProcessEnv} */ ({ ...process.env, ...(options.demo ? { DEMO_MODE: 'true' } : {}) }),
    detached: true,
    stdio: ['ignore', logFd, logFd],
    windowsHide: true,
  });
  closeSync(logFd);
  const pid = /** @type {number} */ (child.pid);
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  child.unref();
  writeRunInfo({ pid, port: config.port, host: config.host, demo: options.demo || config.demoMode, startedAt: new Date().toISOString() });

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (exited || !isAlive(pid)) break;
    if (await fetchJson(config.host, config.port, '/api/health', token)) {
      out.ok(`Panel en marcha (PID ${pid}).`);
      printUrls(config);
      const info = await fetchJson(config.host, config.port, '/api/app-info', token);
      if (info?.setupRequired) out.warn('Gmail no está configurado: el panel ofrece «Activar modo demostración». Usa --auth para autorizar Gmail.');
      if (options.open) openBrowser(`http://localhost:${config.port}`);
      out.info(`Registro: ${logFile}   ·   Parar: ${process.platform === 'win32' ? '.\\start.cmd --stop' : './start.sh --stop'}`);
      return;
    }
    await delay(500);
  }

  clearRunInfo();
  if (isAlive(pid)) process.kill(pid);
  const tail = readTail(logFile, 15);
  throw new Error(`El panel no ha arrancado. Últimas líneas del registro:\n${tail.map(prettyLogLine).join('\n')}`);
}

/**
 * @param {ReturnType<typeof loadConfig>} config
 */
function printUrls(config) {
  const { local, lan, exposed } = listAccessUrls({ host: config.host, port: config.port });
  for (const url of local) out.info(`   ${url}`);
  for (const url of lan) out.info(`   ${url}   (red local)`);
  if (exposed) out.warn('El panel está expuesto en la red local: protégelo con ACCESS_TOKEN y úsalo solo en una red de confianza.');
}

/**
 * @param {Options} options
 * @param {{ fromRestart?: boolean }} [context]
 */
async function stop(options, { fromRestart = false } = {}) {
  const { env, config } = readConfig(options);
  const current = readRunInfo();
  if (current && isAlive(current.pid)) {
    const responding = await fetchJson(current.host, current.port, '/api/health', config.accessToken);
    if (!responding && !options.force) {
      throw new Error(`El proceso ${current.pid} no responde en el puerto ${current.port}. Si estás seguro de que es el panel, usa --stop --force.`);
    }
    process.kill(current.pid, 'SIGTERM');
    for (let i = 0; i < 40 && isAlive(current.pid); i += 1) await delay(250);
    if (isAlive(current.pid)) process.kill(current.pid, 'SIGKILL');
    out.ok(`Panel parado (PID ${current.pid}).`);
  } else if (await fetchJson(config.host, config.port, '/api/health', config.accessToken)) {
    out.warn(`Hay un panel respondiendo en el puerto ${config.port} que no se arrancó con este script (¿npm start en otra terminal?). Páralo desde allí.`);
  } else {
    out.info('El panel no estaba en marcha.');
  }
  clearRunInfo();
  if (!fromRestart && !options.keepMongo && managesMongo(config, options)) stopMongo(env);
}

/**
 * @param {Options} options
 */
async function restart(options) {
  await stop(options, { fromRestart: true });
  await start(options);
}

/**
 * @param {Options} options
 */
async function status(options) {
  const { env, config } = readConfig(options);
  const current = readRunInfo();
  const alive = current ? isAlive(current.pid) : false;
  const health = await fetchJson(config.host, config.port, '/api/app-info', config.accessToken);

  if (alive && health) {
    out.ok(`Panel en marcha (PID ${current?.pid}, desde ${current ? new Date(current.startedAt).toLocaleString('es-ES') : '—'}).`);
    printUrls(config);
    out.info(`   modo: ${health.setupRequired ? 'configuración pendiente (sin Gmail)' : health.demoMode ? 'demostración' : 'Gmail'} · datos: ${health.persistence ?? '—'}`);
  } else if (alive) {
    out.warn(`El proceso ${current?.pid} existe pero no responde en el puerto ${config.port}.`);
  } else if (health) {
    out.warn(`Hay un panel en el puerto ${config.port} arrancado fuera de este script.`);
  } else {
    out.info('Panel: parado.');
  }
  const demo = config.demoMode || Boolean(alive && current?.demo) || Boolean(health?.demoMode);
  if (demo) out.info('Datos: en memoria (modo demostración).');
  else if (managesMongo(config, options)) out.info(`MongoDB: ${mongoState(env)}`);
  else out.info(`Datos: ${config.persistence === 'json' ? `ficheros JSON en ${join(config.dataDir, 'db')}` : 'MongoDB externo'}`);
  if (!demo) reportGmail(config);
}

/**
 * @param {string} file
 * @param {number} lines
 * @returns {string[]}
 */
function readTail(file, lines) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

const LEVELS = /** @type {Record<number, string>} */ ({ 10: 'TRACE', 20: 'DEBUG', 30: 'INFO ', 40: 'WARN ', 50: 'ERROR', 60: 'FATAL' });

/**
 * Pino JSON line → "HH:MM:SS LEVEL message key=value…".
 * @param {string} line
 */
export function prettyLogLine(line) {
  try {
    const entry = JSON.parse(line);
    const { time, level, msg, pid: _pid, role: _role, hostname: _hostname, ...rest } = entry;
    const clock = time ? new Date(time).toLocaleTimeString('es-ES', { hour12: false }) : '--:--:--';
    const extra = Object.entries(rest)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    const label = LEVELS[level] ?? String(level);
    const coloured = level >= 50 ? paint('31', label) : level >= 40 ? paint('33', label) : label;
    return `${clock} ${coloured} ${msg ?? ''}${extra ? `  ${paint('2', extra)}` : ''}`;
  } catch {
    return line;
  }
}

/**
 * @param {Options} options
 */
async function logs(options) {
  const file = join(runDir(), 'web.log');
  if (!existsSync(file)) {
    out.info('Todavía no hay registro (el panel no se ha arrancado con este script).');
    return;
  }
  for (const line of readTail(file, options.lines)) out.info(prettyLogLine(line));
  if (!options.follow) return;
  let size = statSync(file).size;
  out.info(paint('2', '— siguiendo el registro (Ctrl+C para salir) —'));
  for (;;) {
    await delay(1000);
    const current = statSync(file).size;
    if (current < size) size = 0;
    if (current > size) {
      const fd = openSync(file, 'r');
      const buffer = Buffer.alloc(current - size);
      readSync(fd, buffer, 0, buffer.length, size);
      closeSync(fd);
      for (const line of buffer.toString('utf8').split(/\r?\n/).filter(Boolean)) out.info(prettyLogLine(line));
      size = current;
    }
  }
}

async function auth() {
  checkNode();
  if (!existsSync(join(ROOT, 'node_modules'))) throw new Error('Primero instala las dependencias con --install.');
  const result = run(process.execPath, [join(ROOT, 'src', 'entrypoints', 'auth.js')], { inherit: true });
  if (result.status !== 0) process.exitCode = result.status;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  switch (options.command) {
    case 'help':
      out.info(HELP);
      return;
    case 'install':
      return install(options);
    case 'stop':
      return stop(options);
    case 'restart':
      return restart(options);
    case 'status':
      return status(options);
    case 'logs':
      return logs(options);
    case 'auth':
      return auth();
    default:
      return start(options);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof UsageError) {
      out.fail(error.message);
      out.info(HELP);
      process.exit(2);
    }
    const details = /** @type {{ details?: unknown }} */ (error)?.details;
    out.fail(`${error?.message ?? error}${details ? ` ${JSON.stringify(details)}` : ''}`);
    process.exit(1);
  });
}
