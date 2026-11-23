/**
 * Desktop app of the SERVER (Electron): runs the server inside the app and shows the dashboard
 * in a window. Data lives in the user's profile, as JSON files by default (no database to
 * install). The other computers, tablets and phones use a web browser with the address this
 * app shows (window title, notification at start and Archivo → Datos de conexión).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { BrowserWindow, Menu, ipcMain, Notification, app, clipboard, dialog, session, shell } from 'electron';

import { applyDefaults, clientUrls, lanAddresses, loadDesktopConfig, newAccessToken, saveDesktopConfig, serverDefaults } from './config.mjs';
import { authorizeGmail } from './gmailAuth.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TITLE = 'Retreat Manager';
const ICON = join(HERE, '..', 'build', 'icon.png');

const home = () => join(app.getPath('userData'), 'server');
const configFile = () => join(app.getPath('userData'), 'desktop.json');

// `Retreat Manager.exe --minimized`: the server starts and the window stays minimized
// (e.g. a shortcut in the Windows Startup folder, or the server computer that nobody uses).
const START_MINIMIZED = process.argv.includes('--minimized');

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
/** @type {import('electron').BrowserWindow | null} */
let splash = null;
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

/** Small window shown while the server loads, so the app does not look frozen. */
function showSplash() {
  if (START_MINIMIZED) return;
  splash = new BrowserWindow({
    width: 440,
    height: 260,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    show: false,
    icon: ICON,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  let logo = '';
  try {
    logo = `<img src="data:image/png;base64,${readFileSync(ICON).toString('base64')}" width="72" height="72" alt="">`;
  } catch {
    // The banner works without the logo.
  }
  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;height:100%}
    body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;
      border:1px solid #2f6f94;font-family:'Segoe UI',system-ui,sans-serif;color:#fff;-webkit-app-region:drag;
      background:linear-gradient(160deg,#1b4965,#12304a)}
    h1{margin:10px 0 0;font-size:24px;font-weight:600}
    p{margin:0;font-size:14px;opacity:.85}
    small{position:absolute;bottom:10px;right:14px;opacity:.55;font-size:12px}
    .bar{width:260px;height:4px;margin-top:18px;border-radius:2px;background:rgba(255,255,255,.2);overflow:hidden}
    .bar i{display:block;width:40%;height:100%;border-radius:2px;background:#9fd3f0;animation:run 1.2s ease-in-out infinite}
    @keyframes run{0%{transform:translateX(-100%)}100%{transform:translateX(260%)}}
  </style>${logo}<h1>${TITLE}</h1><p>Iniciando el servidor…</p><div class="bar"><i></i></div><small>v${app.getVersion()}</small>`;
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  splash.once('ready-to-show', () => splash?.show());
  splash.on('closed', () => {
    splash = null;
  });
}

function closeSplash() {
  if (splash && !splash.isDestroyed()) splash.close();
  splash = null;
}

/** @param {string} origin */
function openWindow(origin) {
  const main = urls().main;
  mainWindow = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: TITLE,
    icon: ICON,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: join(HERE, 'preload.cjs') },
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
  // Shown when the page is painted (no white flash); minimized when asked to.
  mainWindow.once('ready-to-show', () => {
    closeSplash();
    if (START_MINIMIZED) {
      mainWindow?.showInactive();
      mainWindow?.minimize();
    } else {
      mainWindow?.show();
    }
  });
  void mainWindow.loadURL(origin);
}

// Electron cannot show a print preview, so the page is rendered to a PDF and opened in the system viewer,
// which has preview, printer choice and "save as".
ipcMain.handle('print-preview', async (event) => {
  const pdf = await event.sender.printToPDF({ printBackground: true, preferCSSPageSize: true });
  const file = join(app.getPath('temp'), `retreat-manager-${Date.now()}.pdf`);
  writeFileSync(file, pdf);
  const error = await shell.openPath(file);
  if (error) dialog.showErrorBox(TITLE, `No se pudo abrir el PDF: ${error}`);
});

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
  showSplash();
  try {
    const { startWeb } = await import('../src/entrypoints/startWeb.js');
    web = await startWeb({ logFile, restartHandler: relaunch });
  } catch (error) {
    closeSplash();
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
