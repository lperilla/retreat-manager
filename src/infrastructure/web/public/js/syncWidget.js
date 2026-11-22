/**
 * Header sync widget: last search, state, "Buscar cartas nuevas" (incremental) and, under
 * "Más opciones", "Volver a leer todo el buzón" (full sync, with confirmation). Polls every 2 s ONLY while a sync runs.
 */
import { api, ApiError } from './api.js';
import { $, h } from './dom.js';
import { relativeTime, syncResultSummary } from './format.js';
import { emit, state } from './state.js';
import { confirmDialog, toast, toastError } from './ui.js';

const POLL_MS = 2000;

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {ReturnType<typeof setInterval> | null} */
let clockTimer = null;
let cooldownUntil = 0;
let wasRunning = false;

function render() {
  const status = state.sync;
  const last = $('#sync-last');
  const badge = $('#sync-state');
  const now = /** @type {HTMLButtonElement} */ ($('#sync-now'));
  const full = /** @type {HTMLButtonElement} */ ($('#sync-full'));
  const menu = /** @type {HTMLButtonElement} */ ($('#sync-menu'));

  if (!status) {
    last.textContent = 'Última búsqueda: —';
    badge.className = 'badge text-bg-secondary';
    badge.textContent = 'Sin datos';
    now.disabled = true;
    full.disabled = true;
    menu.disabled = state.info?.setupRequired ?? true;
    return;
  }

  last.textContent = `Última búsqueda: ${relativeTime(status.lastSuccessAt)}`;
  last.title = status.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString('es-ES') : '';
  if (status.running) {
    badge.className = 'badge text-bg-info';
    badge.textContent = 'Buscando…';
  } else if (status.lastSyncFailed) {
    badge.className = 'badge text-bg-danger';
    badge.textContent = 'Con error';
  } else if (status.lastSuccessAt) {
    badge.className = 'badge text-bg-success';
    badge.textContent = 'Al día';
  } else {
    badge.className = 'badge text-bg-secondary';
    badge.textContent = 'Sin buscar';
  }

  const cooldown = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
  const blocked = status.running || cooldown > 0;
  now.disabled = blocked;
  full.disabled = blocked;
  menu.disabled = false;
  now.textContent = status.running ? 'Buscando…' : cooldown > 0 ? `Buscar cartas nuevas (${cooldown} s)` : 'Buscar cartas nuevas';

  const warning = $('#sync-warning');
  warning.hidden = !status.lastSyncFailed;
  $('#sync-warning-detail').textContent = status.lastSyncFailed && status.lastError ? `Detalle: ${status.lastError}` : '';
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => void refreshSyncStatus(), POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * @param {any} status
 */
function onFinished(status) {
  if (status.lastSyncFailed) {
    toast(`La sincronización ha fallado. ${status.lastError ?? ''}`.trim(), 'danger');
  } else if (status.lastResult) {
    toast(syncResultSummary(status.lastResult), status.lastResult.added > 0 ? 'success' : 'info');
  }
  emit('data-changed');
}

export async function refreshSyncStatus() {
  try {
    const status = await api.syncStatus();
    state.sync = status;
    cooldownUntil = Math.max(cooldownUntil, Date.now() + status.cooldownRemainingSeconds * 1000);
    if (status.running) {
      startPolling();
    } else {
      stopPolling();
      if (wasRunning) onFinished(status);
    }
    wasRunning = status.running;
    render();
    emit('sync-status', status);
  } catch (error) {
    stopPolling();
    if (!(error instanceof ApiError && error.code === 'MAIL_SOURCE_NOT_CONFIGURED')) toastError(error);
  }
}

/**
 * @param {'incremental' | 'full'} mode
 */
async function startSync(mode) {
  try {
    await api.startSync(mode);
    wasRunning = true;
    state.sync = { ...(state.sync ?? {}), running: true };
    render();
    startPolling();
  } catch (error) {
    if (error instanceof ApiError && error.retryAfterSeconds) {
      cooldownUntil = Date.now() + error.retryAfterSeconds * 1000;
      render();
    }
    if (error instanceof ApiError && error.code === 'SYNC_IN_PROGRESS') startPolling();
    toastError(error);
  }
}

export function initSyncWidget() {
  $('#sync-now').addEventListener('click', () => void startSync('incremental'));
  $('#sync-full').addEventListener('click', async () => {
    const accepted = await confirmDialog({
      title: 'Volver a leer todo el buzón',
      body: h(
        'div',
        {},
        h('p', { text: 'Se vuelven a descargar todas las cartas del buzón que cumplen el filtro configurado. Úsalo si algo no cuadra; puede tardar unos minutos.' }),
        h('p', { class: 'mb-0', text: 'No se pierden las asignaciones manuales, el estado de impresión ni las marcas de «vista».' }),
      ),
      confirmLabel: 'Leer todo el buzón',
    });
    if (accepted) await startSync('full');
  });
  clockTimer = clockTimer ?? setInterval(render, 1000);
  render();
}
