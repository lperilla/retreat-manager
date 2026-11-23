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
  labelPrefix: 'Prefijo de las etiquetas',
  printedLabel: 'Etiqueta de cartas impresas',
  query: 'Búsqueda de Gmail',
  startDate: 'Leer desde el día',
  labelId: 'Id de etiqueta de Gmail',
  requestsPerSecond: 'Descargas por segundo',
  concurrency: 'Descargas simultáneas',
  syncIntervalMinutes: 'Buscar cartas nuevas cada (minutos)',
};

/** @type {any} */
let loaded = null;

/** @param {string} key @returns {HTMLInputElement} */
const field = (key) => /** @type {HTMLInputElement} */ ($(`#set-${key}`));

function showPrefixExample() {
  const prefix = field('labelPrefix').value.trim();
  $('#set-labelPrefix-example').textContent = `Ejemplo de etiqueta: «${prefix ? `${prefix}/` : ''}María García»`;
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
        toast(pending ? 'Configuración guardada. Hay cambios que necesitan reiniciar.' : saved.reloaded ? 'Configuración guardada y aplicada.' : 'Configuración guardada.');
      } catch (error) {
        toastError(error);
      }
    });
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
