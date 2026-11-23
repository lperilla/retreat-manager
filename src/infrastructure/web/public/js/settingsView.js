/**
 * "Configuración": Gmail label options, which mail is read and the sync pace.
 * Values are saved on the server (data/settings.json) and applied without restarting,
 * except the ones listed in `restartPending`, which need a restart (offered from here).
 */
import { api } from './api.js';
import { $, h, withBusy } from './dom.js';
import { confirmDialog, toast, toastError } from './ui.js';

const TEXT_FIELDS = ['labelPrefix', 'printedLabel', 'query', 'startDate', 'labelId'];
const NUMBER_FIELDS = ['requestsPerSecond', 'concurrency', 'syncIntervalMinutes'];
const FIELD_NAMES = {
  labelsEnabled: 'Activar etiquetas de Gmail',
  labelPrefix: 'Etiqueta padre de los participantes',
  printedLabel: 'Etiqueta de cartas impresas',
  query: 'Búsqueda de Gmail',
  startDate: 'Leer desde el día',
  labelId: 'Id de etiqueta de Gmail',
  requestsPerSecond: 'Descargas por segundo',
  concurrency: 'Descargas simultáneas',
  syncIntervalMinutes: 'Buscar cartas nuevas cada (minutos)',
};

/**
 * Help shown from the (i) button next to each field: what it is, what it does and an example.
 * @type {Record<string, string>}
 */
const HELP = {
  labelsEnabled:
    'Qué es: un interruptor general. Qué hace: si está activado, la aplicación crea en Gmail una etiqueta por participante y la pone en sus correos; también pone la etiqueta de «impresas» cuando se imprimen. Para qué sirve: poder ver y filtrar las cartas directamente en Gmail. Necesita un permiso más amplio de Gmail: tras activarlo ejecuta npm run auth una vez.',
  labelPrefix:
    'Qué es: la etiqueta padre bajo la que se agrupan todas las etiquetas de participante. Qué hace: la aplicación crea esa etiqueta en Gmail y cuelga de ella una etiqueta por participante, como una carpeta. Ejemplo: con «Retiro» verás «Retiro» y dentro «María García», «Juan Pérez»…; vacío, las etiquetas de participante quedan sueltas. Al cambiarla, las antiguas se quitan de los correos y se borran de Gmail.',
  printedLabel:
    'Qué es: el nombre de la etiqueta que se añade a una carta cuando está impresa. Qué hace: se pone al marcarla como impresa (o al exportar marcando como impresas) y se quita si la desmarcas. Para qué sirve: distinguir en Gmail lo que ya se imprimió de lo que falta.',
  query:
    'Qué es: una búsqueda de Gmail que limita qué correos se tratan como cartas. Qué hace: solo se leen los mensajes que cumplan la búsqueda. Ejemplos: «to:cartas@ejemplo.com» o «-from:noreply@». Vacío = todos los correos recibidos (salvo spam, papelera y borradores). Si lo cambias, la siguiente sincronización vuelve a leer todo el buzón.',
  startDate:
    'Qué es: el primer día cuyos correos se leen. Qué hace: ignora todo lo recibido antes de esa fecha. Para qué sirve: no importar correos de retiros anteriores y hacer más rápida la primera sincronización. Vacío = sin límite. Si lo cambias, la siguiente sincronización vuelve a leer todo el buzón.',
  labelId:
    'Qué es: el identificador interno de una etiqueta que ya existe en Gmail (algo como Label_1234567890). Qué hace: si lo pones, solo se leen los correos que tengan esa etiqueta, y la búsqueda de arriba se ignora. Para qué sirve: leer solo una carpeta concreta del buzón. Vacío = no se usa.',
  requestsPerSecond:
    'Qué es: el número máximo de correos que se descargan de Gmail por segundo. Qué hace: reparte las descargas para no superar el límite por minuto de Gmail. Para qué sirve: evitar el error «Quota exceeded» en sincronizaciones grandes. Si aparece, bájalo (por ejemplo a 3). 0 = sin límite.',
  concurrency:
    'Qué es: cuántos correos se descargan a la vez. Qué hace: más descargas simultáneas acaban antes pero gastan más cuota de Gmail. Para qué sirve: ajustar la velocidad; si Gmail se queja de cuota, bájalo a 2.',
  syncIntervalMinutes:
    'Qué es: cada cuántos minutos la aplicación busca cartas nuevas sola. Qué hace: lanza una sincronización incremental automática con esa frecuencia. Ejemplo: 15 = cada 15 minutos. 0 = solo cuando pulsas «Buscar cartas nuevas». Este cambio se aplica al reiniciar la aplicación.',
};

/** Adds an (i) button after each field label that opens its help (closes when clicking elsewhere). */
function addHelpButtons() {
  const bootstrap = /** @type {any} */ (window).bootstrap;
  for (const [key, text] of Object.entries(HELP)) {
    const label = document.querySelector(`label[for="set-${key}"]`);
    if (!label || label.querySelector('.info-btn')) continue;
    const name = FIELD_NAMES[/** @type {keyof typeof FIELD_NAMES} */ (key)];
    const button = h('button', {
      type: 'button',
      class: 'btn btn-link btn-sm p-0 ms-1 align-baseline info-btn',
      'aria-label': `Qué es «${name}»`,
      'data-bs-toggle': 'popover',
      'data-bs-trigger': 'focus',
      'data-bs-placement': 'top',
      'data-bs-title': name,
      'data-bs-content': text,
      text: 'ⓘ',
    });
    label.append(button);
    bootstrap?.Popover.getOrCreateInstance(button);
  }
}

/** @type {any} */
let loaded = null;

/** @param {string} key @returns {HTMLInputElement} */
const field = (key) => /** @type {HTMLInputElement} */ ($(`#set-${key}`));

function showPrefixExample() {
  const prefix = field('labelPrefix').value.trim();
  $('#set-labelPrefix-example').textContent = prefix ? `En Gmail: «${prefix}» y dentro «María García»` : 'En Gmail: «María García» (sin etiqueta padre)';
}

/**
 * @param {string} key
 * @param {any} value
 */
function describeDefault(key, value) {
  if (key === 'labelsEnabled') return value ? 'activado' : 'desactivado';
  if (value === '' || value === null || value === undefined) return 'vacío';
  if (key === 'requestsPerSecond' && Number(value) === 0) return '0 (sin límite)';
  return String(value);
}

/** Shows "Por defecto: …" under every field (created once). */
function showDefaults(defaults) {
  for (const key of ['labelsEnabled', ...TEXT_FIELDS, ...NUMBER_FIELDS]) {
    const input = field(key);
    let hint = document.getElementById(`set-${key}-default`);
    if (!hint) {
      hint = h('div', { class: 'form-text', id: `set-${key}-default` });
      // For the switch, the hint goes under its whole row.
      (input.closest('.form-check') ?? input).after(hint);
    }
    hint.textContent = `Por defecto: ${describeDefault(key, defaults[key])}`;
  }
}

/** @param {any} data */
function showRestart(data) {
  const pending = data.restartPending ?? [];
  $('#settings-restart').hidden = pending.length === 0;
  if (pending.length === 0) return;
  const names = pending.map((/** @type {keyof typeof FIELD_NAMES} */ key) => `«${FIELD_NAMES[key]}»`).join(', ');
  $('#settings-restart-text').textContent = data.canRestart
    ? `Estos cambios se aplicarán al reiniciar la aplicación: ${names}.`
    : `Estos cambios se aplicarán al reiniciar la aplicación: ${names}. Páala y vuelve a arrancarla con start.cmd (esta ventana no puede reiniciarla).`;
  $('#settings-restart-btn').hidden = !data.canRestart;
}

/** @param {any} data */
function fill(data) {
  loaded = data;
  const { values } = data;
  field('labelsEnabled').checked = Boolean(values.labelsEnabled);
  for (const key of TEXT_FIELDS) field(key).value = values[key] ?? '';
  for (const key of NUMBER_FIELDS) field(key).value = String(values[key] ?? '');
  $('#settings-demo').hidden = !data.demoMode;
  $('#settings-scope').hidden = !(values.labelsEnabled && data.tokenHasLabelScope === false);
  $('#settings-status').textContent = '';
  showDefaults(data.defaults);
  showRestart(data);
  showPrefixExample();
}

export async function loadSettings() {
  fill(await api.settings());
}

function collect() {
  /** @type {Record<string, unknown>} */
  const values = { labelsEnabled: field('labelsEnabled').checked };
  for (const key of TEXT_FIELDS) values[key] = field(key).value.trim();
  for (const key of NUMBER_FIELDS) values[key] = field(key).value.trim();
  return values;
}

/** After asking for the restart: waits until the app answers again, then reloads the page. */
async function waitForRestart() {
  $('#settings-status').textContent = 'Reiniciando la aplicación…';
  await new Promise((resolve) => setTimeout(resolve, 3000));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch('/api/health', { cache: 'no-store' });
      if (response.ok) {
        window.location.reload();
        return;
      }
    } catch {
      // Still restarting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  $('#settings-status').textContent = 'La aplicación no responde todavía. Recarga la página en unos segundos.';
}

export function initSettings() {
  addHelpButtons();
  field('labelPrefix').addEventListener('input', showPrefixExample);
  $('#settings-reset').addEventListener('click', () => {
    if (loaded) fill(loaded);
  });
  $('#settings-defaults').addEventListener('click', () => {
    if (!loaded) return;
    const { defaults } = loaded;
    field('labelsEnabled').checked = Boolean(defaults.labelsEnabled);
    for (const key of [...TEXT_FIELDS, ...NUMBER_FIELDS]) field(key).value = String(defaults[key] ?? '');
    showPrefixExample();
    $('#settings-status').textContent = 'Valores por defecto cargados. Pulsa Guardar para aplicarlos.';
  });
  $('#settings-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void withBusy(/** @type {HTMLButtonElement} */ ($('#settings-save')), async () => {
      try {
        const saved = await api.saveSettings(collect());
        fill(saved);
        $('#settings-status').textContent = 'Guardado.';
        const pending = (saved.restartPending ?? []).length > 0;
        toast(saved.labelsUpdating ? 'Configuración guardada. Las etiquetas de Gmail se están actualizando; las antiguas se quitarán.' : pending ? 'Configuración guardada. Hay cambios que necesitan reiniciar.' : saved.reloaded ? 'Configuración guardada y aplicada.' : 'Configuración guardada.');
      } catch (error) {
        toastError(error);
      }
    });
  });
  $('#settings-labels-reset').addEventListener('click', () => {
    void (async () => {
      const accepted = await confirmDialog({
        title: 'Inicializar etiquetas',
        body: 'Se borrarán de Gmail las etiquetas de la aplicación (etiqueta padre, participantes e «Impreso») y se volverán a crear y aplicar a los correos. Puede tardar varios minutos.',
        confirmLabel: 'Inicializar',
      });
      if (!accepted) return;
      await withBusy(/** @type {HTMLButtonElement} */ ($('#settings-labels-reset')), async () => {
        try {
          const result = await api.resetLabels();
          toast(`Etiquetas inicializadas: ${result.applied} correos etiquetados${result.failed ? `, ${result.failed} con error` : ''}.`);
        } catch (error) {
          toastError(error);
        }
      });
    })();
  });
  $('#settings-restart-btn').addEventListener('click', () => {
    void (async () => {
      const accepted = await confirmDialog({
        title: 'Reiniciar la aplicación',
        body: 'La aplicación se para y se vuelve a arrancar (tarda unos segundos). Los datos se conservan. Esta página se recargará sola.',
        confirmLabel: 'Reiniciar',
      });
      if (!accepted) return;
      try {
        await api.restart();
        await waitForRestart();
      } catch (error) {
        toastError(error);
      }
    })();
  });
}
