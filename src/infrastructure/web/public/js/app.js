/**
 * Dashboard entry point: hash router, boot sequence, shared actions.
 */
import { api } from './api.js';
import { initAssignModal } from './assignModal.js';
import { initDashboard, loadDashboard } from './dashboardView.js';
import { $, h, withBusy } from './dom.js';
import { plural } from './format.js';
import { loadHistory } from './historyView.js';
import { loadParticipant } from './participantView.js';
import { loadParticipants } from './participantsView.js';
import { loadReview } from './reviewView.js';
import { ASSIGNMENT_STATUS_LABELS } from './labels.js';
import { initSyncWidget, refreshSyncStatus } from './syncWidget.js';
import { on, state } from './state.js';
import { confirmDialog, showSummary, toast, toastError } from './ui.js';

const VIEWS = ['dashboard', 'participant', 'people', 'review', 'history'];

/** @returns {{ view: string, param: string | null, mode?: 'list' | 'detail' | 'new' | 'edit' }} */
function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [first, ...rest] = hash.split('/');
  if (first === 'participante' && rest[0]) return { view: 'participant', param: decodeURIComponent(rest.join('/')) };
  if (first === 'participantes') {
    if (!rest[0]) return { view: 'people', param: null, mode: 'list' };
    if (rest[0] === 'nuevo') return { view: 'people', param: null, mode: 'new' };
    return { view: 'people', param: decodeURIComponent(rest[0]), mode: rest[1] === 'editar' ? 'edit' : 'detail' };
  }
  if (first === 'revisar') return { view: 'review', param: null };
  if (first === 'historial') return { view: 'history', param: null };
  return { view: 'dashboard', param: null };
}

/**
 * @param {string} view
 */
function showView(view) {
  for (const name of VIEWS) $(`#view-${name}`).hidden = name !== view;
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = /** @type {HTMLElement} */ (link).dataset.nav === view;
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.body.classList.toggle('has-batch-bar', view === 'dashboard' && state.selection.size > 0);
  $('#batch-bar').hidden = view !== 'dashboard' || state.selection.size === 0;
}

let routeToken = 0;

/**
 * @param {{ focus?: boolean }} [options]
 */
async function route({ focus = true } = {}) {
  if (state.info?.setupRequired) return;
  const token = ++routeToken;
  const { view, param, mode } = parseRoute();
  showView(view);
  void refreshRetreatBanner();
  const titles = { dashboard: 'Cartas del retiro', review: 'Por revisar · Cartas del retiro', history: 'Historial · Cartas del retiro' };
  if (view !== 'participant' && view !== 'people') document.title = titles[/** @type {keyof typeof titles} */ (view)];
  try {
    if (view === 'dashboard') await loadDashboard();
    else if (view === 'participant' && param) await loadParticipant(param);
    else if (view === 'people') await loadParticipants({ mode: mode ?? 'list', id: param });
    else if (view === 'review') await loadReview();
    else if (view === 'history') await loadHistory();
  } catch (error) {
    if (token === routeToken) toastError(error);
  }
  if (focus && token === routeToken) $('#main').focus({ preventScroll: false });
}

const BANNER_DATE = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });

/** Warns when the retreat is over and its personal data is about to be deleted automatically. */
async function refreshRetreatBanner() {
  const banner = document.getElementById('retreat-banner');
  if (!banner) return;
  try {
    const retreat = await api.retreat();
    if (!retreat.ended || !retreat.deletionDate) {
      banner.hidden = true;
      return;
    }
    $('#retreat-banner-text').textContent =
      `«${retreat.name}» ha terminado. Sus datos personales (participantes, alergias, contactos de emergencia, cartas y archivos) se borrarán automáticamente el ${BANNER_DATE.format(new Date(retreat.deletionDate))}${retreat.daysUntilDeletion !== null ? ` (en ${plural(retreat.daysUntilDeletion, 'día', 'días')})` : ''}. Exporta o imprime antes lo que necesites y recuerda borrar los correos en Gmail.`;
    banner.hidden = false;
  } catch {
    banner.hidden = true;
  }
}

async function recompute(/** @type {HTMLButtonElement} */ button) {
  const accepted = await confirmDialog({
    title: 'Reasignar cartas',
    body: 'Se volverá a calcular a quién va cada carta usando la lista actual de participantes y alias. Las asignaciones manuales no se tocan. Úsalo después de cambiar la lista de participantes.',
    confirmLabel: 'Reasignar cartas',
  });
  if (!accepted) return;
  await withBusy(button, async () => {
    try {
      const summary = await api.recompute();
      const changes = summary.changes.map((/** @type {any} */ change) => {
        /** @param {any} side */
        const describe = (side) =>
          side.participants.length > 0 ? side.participants.map((/** @type {any} */ p) => p.displayName).join(', ') : ASSIGNMENT_STATUS_LABELS[side.status];
        return h('li', {}, h('strong', { text: change.subject || '(Sin asunto)' }), `: ${describe(change.before)} → ${describe(change.after)}`);
      });
      showSummary(
        'Resultado de la reasignación',
        h(
          'div',
          {},
          h(
            'p',
            {},
            `Revisadas ${plural(summary.examined, 'carta', 'cartas')}: ${plural(summary.changed, 'cambio', 'cambios')}. `,
            `${plural(summary.manualOverrides, 'asignación manual respetada', 'asignaciones manuales respetadas')}. `,
            `Asignadas: ${summary.assigned} · Por revisar: ${summary.needsReview} · Sin asignar: ${summary.unassigned}.`,
          ),
          changes.length > 0 ? h('ul', { class: 'mb-0' }, changes) : h('p', { class: 'text-body-secondary mb-0', text: 'No ha cambiado ninguna asignación.' }),
          summary.truncated ? h('p', { class: 'small text-body-secondary mt-2 mb-0', text: 'Se muestran solo los primeros cambios.' }) : null,
        ),
      );
      void route({ focus: false });
    } catch (error) {
      toastError(error);
    }
  });
}

function showSetup() {
  $('#setup-card').hidden = false;
  for (const name of VIEWS) $(`#view-${name}`).hidden = true;
  /** @type {HTMLButtonElement} */ ($('#sync-now')).disabled = true;
  $('#enable-demo').addEventListener(
    'click',
    (event) =>
      void withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
        try {
          state.info = await api.enableDemo();
          $('#setup-card').hidden = true;
          await start();
          toast('Modo demostración activado.');
        } catch (error) {
          toastError(error);
        }
      }),
    { once: true },
  );
}

async function start() {
  $('#demo-banner').hidden = !state.info.demoMode;
  $('#logout-item').hidden = !state.info.accessControl;
  await refreshSyncStatus();
  await route({ focus: false });
}

async function boot() {
  initSyncWidget();
  initAssignModal();
  initDashboard();
  $('#recompute').addEventListener('click', (event) => void recompute(/** @type {HTMLButtonElement} */ (event.currentTarget)));
  window.addEventListener('hashchange', () => void route());
  on('data-changed', () => void route({ focus: false }));

  try {
    state.info = await api.appInfo();
  } catch (error) {
    toastError(error);
    return;
  }
  if (state.info.setupRequired) {
    showSetup();
    return;
  }
  await start();
}

void boot();
