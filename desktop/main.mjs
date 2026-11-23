/**
 * Desktop app of the SERVER (Electron): runs the server inside the app and shows the dashboard
 * in a window. Data lives in the user's profile, as JSON files by default (no database to
 * install). The other computers, tablets and phones use a web browser with the address this
 * app shows (window title, notification at start and Archivo → Datos de conexión).
 */
import { existsSync, mkdirSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { BrowserWindow, Menu, Notification, app, clipboard, dialog, session, shell } from 'electron';

import { applyDefaults, clientUrls, lanAddresses, loadDesktopConfig, newAccessToken, saveDesktopConfig, serverDefaults } from './config.mjs';
import { authorizeGmail } from './gmailAuth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TITLE = 'Gestión del retiro';
const ICON = join(HERE, '..', 'build', 'icon.png');

const home = () => join(app.getPath('userData'), 'server');
const configFile = () => join(app.getPath('userData'), 'desktop.json');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {Awaited<ReturnType<import('../src/entrypoints/startWeb.js').startWeb>> | null} */
let web = null;
let quitting = false;

// Another data folder (for trying the app without touching the real data).
if (process.env.RETREAT_DESKTOP_DATA) app.setPath('userData', process.env.RETREAT_DESKTOP_DATA);
app.setAppUserModelId('com.retreat.manager');
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

/** Restarts the app (Configuración → "Reiniciar ahora", or after connecting Gmail). */
function relaunch() {
  app.relaunch();
  quitting = true;
  void (web ? web.close() : Promise.resolve()).finally(() => app.exit(0));
}

/** @param {string} message @param {string} [detail] */
function fail(message, detail) {
  dialog.showErrorBox(TITLE, detail ? `${message}\n\n${detail}` : message);
}

/** Addresses for the other devices (recomputed: the IP may change while the app is open). */
function urls() {
  const port = web?.config.port ?? 3000;
  return clientUrls({ addresses: lanAddresses(networkInterfaces()), hostname: hostname(), port });
}

/** Asks for credentials.json and authorizes the mailbox. Returns true when Gmail is connected. */
async function connectGmail({ firstRun = false } = {}) {
  if (firstRun) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: TITLE,
      message: 'Conectar con el buzón de Gmail',
      detail:
        'Necesitas el archivo credentials.json de Google Cloud (la guía de instalación explica cómo conseguirlo).\n\n' +
        'Si todavía no lo tienes, pulsa «Más tarde»: podrás conectarlo después desde Archivo → Conectar con Gmail, o probar la aplicación con datos de demostración.',
      buttons: ['Elegir credentials.json', 'Más tarde'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return false;
  }
  const picked = await dialog.showOpenDialog({ title: 'Elige el archivo credentials.json', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (picked.canceled || picked.filePaths.length === 0) return false;
  try {
    await dialog.showMessageBox({
      type: 'info',
      title: TITLE,
      message: 'Se va a abrir el navegador',
      detail: 'Inicia sesión con la cuenta de Gmail donde llegan las cartas y acepta los permisos. Después vuelve a esta aplicación.',
      buttons: ['Continuar'],
    });
    const result = await authorizeGmail({ home: home(), credentialsFile: picked.filePaths[0], openUrl: (url) => void shell.openExternal(url) });
    await dialog.showMessageBox({
      type: 'info',
      title: TITLE,
      message: 'Gmail conectado',
      detail: result.hasRefreshToken
        ? 'La aplicación ya puede leer las cartas.'
        : 'Gmail no ha dado un permiso de larga duración. Si la conexión caduca, quita el acceso de la aplicación en tu cuenta de Google y vuelve a conectar.',
    });
    return true;
  } catch (error) {
    fail('No se ha podido conectar con Gmail.', /** @type {Error} */ (error).message);
    return false;
  }
}

function showConnectionData() {
  const { all } = urls();
  const code = web?.config.accessToken ?? '';
  void dialog
    .showMessageBox({
      type: 'info',
      title: TITLE,
      message: 'Cómo entran los demás',
      detail:
        `En cualquier ordenador, tablet o móvil conectado a la misma red (Wi-Fi), abre el navegador y escribe:\n\n${all[0] ?? '(no hay red)'}\n\n` +
        (all.length > 1 ? `Si no funciona, prueba con:\n${all.slice(1).join('\n')}\n\n` : '') +
        `Código de acceso (se pide la primera vez en cada dispositivo):\n\n${code}`,
      buttons: ['Copiar dirección', 'Copiar código', 'Cerrar'],
      defaultId: 2,
      cancelId: 2,
      noLink: true,
    })
    .then(({ response }) => {
      if (response === 0 && all[0]) clipboard.writeText(all[0]);
      if (response === 1 && code) clipboard.writeText(code);
    });
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Archivo',
        submenu: [
          { label: 'Cómo entran los demás (dirección y código)', click: showConnectionData },
          { label: 'Conectar con Gmail…', click: () => void connectGmail().then((ok) => ok && relaunch()) },
          { label: 'Abrir carpeta de datos', click: () => void shell.openPath(home()) },
          { type: 'separator' },
          { role: 'quit', label: 'Salir' },
        ],
      },
      {
        label: 'Ver',
        submenu: [
          { role: 'reload', label: 'Recargar' },
          { type: 'separator' },
          { role: 'zoomIn', label: 'Aumentar' },
          { role: 'zoomOut', label: 'Reducir' },
          { role: 'resetZoom', label: 'Tamaño normal' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Pantalla completa' },
        ],
      },
    ]),
  );
}

/** @param {string} origin */
function openWindow(origin) {
  const main = urls().main;
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: TITLE,
    icon: ICON,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  // The title always shows the address for the other devices.
  const title = () => (main ? `${TITLE} — los demás entran en ${main}` : TITLE);
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow?.setTitle(title());
  });
  mainWindow.setTitle(title());
  // Pages of this server (for example the print view) open inside the app; anything else in the browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin)) return { action: 'allow' };
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(origin);
}

async function run() {
  const folder = home();
  mkdirSync(folder, { recursive: true });

  let config = loadDesktopConfig(configFile());
  if (!config.accessToken) {
    config = { ...config, accessToken: newAccessToken() };
    saveDesktopConfig(configFile(), config);
  }

  // An optional .env in the data folder wins (e.g. MongoDB); the desktop defaults fill the rest.
  dotenv.config({ path: join(folder, '.env'), quiet: true });
  applyDefaults(process.env, serverDefaults({ home: folder, accessToken: /** @type {string} */ (config.accessToken) }));

  const firstRun = !existsSync(join(folder, 'token.json'));
  if (firstRun) await connectGmail({ firstRun: true });

  const logFile = join(folder, 'logs', 'servidor.log');
  const { startWeb } = await import('../src/entrypoints/startWeb.js');
  try {
    web = await startWeb({ logFile, restartHandler: relaunch });
  } catch (error) {
    const busy = /** @type {NodeJS.ErrnoException} */ (error).code === 'EADDRINUSE';
    fail(
      busy ? `El puerto ${process.env.PORT} ya está en uso (¿la aplicación ya está abierta, o hay otro programa usando ese puerto?).` : 'No se ha podido iniciar el servidor.',
      `${/** @type {Error} */ (error).message}\n\nRegistro: ${logFile}`,
    );
    app.exit(1);
    return;
  }

  // This computer enters with the access code without asking for it.
  const local = `http://127.0.0.1:${web.config.port}`;
  const code = web.config.accessToken;
  if (code) {
    session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${local}/*`] }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, Authorization: `Bearer ${code}` } });
    });
  }
  buildMenu();
  openWindow(local);

  const { main } = urls();
  if (firstRun) showConnectionData();
  else if (main && Notification.isSupported()) {
    const notice = new Notification({ title: 'Servidor en marcha', body: `Los demás dispositivos entran en ${main}`, icon: ICON });
    notice.on('click', showConnectionData);
    notice.show();
  }
}

app.whenReady().then(() =>
  run().catch((error) => {
    fail('La aplicación no ha podido arrancar.', String(error?.stack ?? error));
    app.exit(1);
  }),
);

app.on('window-all-closed', () => app.quit());

// Stop the server cleanly before leaving.
app.on('before-quit', (event) => {
  if (!web || quitting) return;
  event.preventDefault();
  quitting = true;
  void web.close().finally(() => app.exit(0));
});
