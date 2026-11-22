/**
 * Letters dashboard: the three steps (receive, review, print), one line of figures, the
 * participant directory (selection, search, filter chips, sort, badges), novelties and the
 * batch bar.
 */
import { api } from './api.js';
import { $, debounce, h, replaceChildren, withBusy } from './dom.js';
import { compareNames, lettersLabel, normalize, plural, relativeTime } from './format.js';
import { exportLetters, printLetters } from './exportActions.js';
import { emit, state } from './state.js';
import { toast, toastError } from './ui.js';

/** @type {Record<string, (row: any) => boolean>} */
const FILTERS = {
  all: () => true,
  'with-letters': (row) => row.letterCount > 0,
  'without-letters': (row) => row.letterCount === 0,
  pending: (row) => row.printStatus === 'pending',
  printed: (row) => row.printStatus === 'printed',
  'with-warnings': (row) => row.warningCount > 0,
  'with-news': (row) => row.newCount > 0,
};

/** Directory filter chosen with the chips. */
let directoryFilter = 'all';

/**
 * Linked names: the first `max`, then "y N más".
 * @param {any[]} participants
 * @param {number} max
 */
function kpiNames(participants, max) {
  const shown = participants.slice(0, max).flatMap((/** @type {any} */ p, /** @type {number} */ index) => [
    index > 0 ? ', ' : null,
    h('a', { href: `#/participante/${encodeURIComponent(p.id)}`, text: p.displayName }),
  ]);
  return participants.length > max ? [...shown, h('span', { class: 'kpi-more', text: ` y ${participants.length - max} más` })] : shown;
}

/**
 * Most letters, fewest letters (among those who have some) and no letters.
 * @param {any} kpis
 */
function renderKpis(kpis) {
  const rows = state.participants;
  const withLetters = rows.filter((row) => row.letterCount > 0);
  const byName = (/** @type {any} */ a, /** @type {any} */ b) => compareNames(a.displayName, b.displayName);
  const asRefs = (/** @type {any[]} */ list) => list.sort(byName).map((row) => ({ id: row.participantId, displayName: row.displayName }));

  const most = kpis.mostLetters;
  $('#kpi-most-count').textContent = most.participants.length > 0 ? String(most.count) : '—';
  $('#kpi-most-unit').textContent = most.participants.length > 0 ? (most.count === 1 ? 'carta' : 'cartas') : '';
  replaceChildren($('#kpi-most-names'), most.participants.length > 0 ? kpiNames(most.participants, 4) : 'Todavía no hay cartas asignadas.');

  const min = withLetters.length > 0 ? Math.min(...withLetters.map((row) => row.letterCount)) : 0;
  const fewest = asRefs(withLetters.filter((row) => row.letterCount === min));
  const sameAsMost = withLetters.length > 0 && min === most.count;
  $('#kpi-fewest-count').textContent = withLetters.length > 0 ? String(min) : '—';
  $('#kpi-fewest-unit').textContent = withLetters.length > 0 ? (min === 1 ? 'carta' : 'cartas') : '';
  replaceChildren(
    $('#kpi-fewest-names'),
    withLetters.length === 0 ? 'Nadie tiene cartas todavía.' : sameAsMost ? 'Todos los que tienen cartas tienen las mismas.' : kpiNames(fewest, 4),
  );

  const zero = kpis.zeroLetterParticipants;
  const clear = kpis.participantCount > 0 && zero.length === 0;
  $('#kpi-zero').classList.toggle('is-clear', clear);
  $('#kpi-zero-count').textContent = kpis.participantCount > 0 ? String(zero.length) : '—';
  $('#kpi-zero-unit').textContent = kpis.participantCount > 0 ? `de ${plural(kpis.participantCount, 'participante', 'participantes')}` : '';
  replaceChildren($('#kpi-zero-names'), clear ? 'Todos tienen al menos una carta.' : kpiNames(zero, 6));
  /** @type {HTMLElement} */ ($('#kpi-zero-filter')).hidden = zero.length === 0;
}

/**
 * The three steps of the work and one discreet line with the other figures.
 * @param {any} kpis
 * @param {any} sync
 */
function renderSteps(kpis, sync) {
  $('#step-receive-value').textContent = plural(kpis.totalLetters, 'carta recibida', 'cartas recibidas');
  $('#step-receive-detail').textContent = sync?.lastSuccessAt ? `Última búsqueda ${relativeTime(sync.lastSuccessAt)}` : 'Todavía no se ha buscado en el correo';

  const review = kpis.reviewQueueSize;
  $('#step-review').classList.toggle('is-done', review === 0);
  $('#step-review-value').textContent = review === 0 ? 'Todo revisado' : `${plural(review, 'carta necesita', 'cartas necesitan')} tu ayuda`;
  $('#step-review-detail').textContent = review === 0 ? 'Todas las cartas tienen destinatario.' : 'No se sabe con seguridad para quién son.';
  /** @type {HTMLElement} */ ($('#step-review-link')).hidden = review === 0;

  const pending = state.participants.filter((row) => row.printStatus === 'pending' && row.letterCount > 0);
  $('#step-print').classList.toggle('is-done', pending.length === 0 && kpis.totalLetters > 0);
  $('#step-print-value').textContent = pending.length === 0 ? 'Nada pendiente' : `${plural(pending.length, 'participante pendiente', 'participantes pendientes')}`;
  $('#step-print-detail').textContent =
    pending.length === 0 ? `${plural(kpis.printedCount, 'participante impreso', 'participantes impresos')}` : `${lettersLabel(pending.reduce((sum, row) => sum + (row.unprintedCount ?? row.letterCount), 0))} por imprimir`;
  const printButton = /** @type {HTMLButtonElement} */ ($('#step-print-pending'));
  printButton.disabled = pending.length === 0;

  renderKpis(kpis);

  const line = [];
  if (kpis.newLettersCount > 0) line.push([h('strong', { text: String(kpis.newLettersCount) }), ' sin ver por el equipo']);
  replaceChildren($('#stats-line'), line.flatMap((part, index) => (index > 0 ? [' · ', ...part] : part)));

  $('#nav-review-count').textContent = String(review);
  $('#tab-review-count').textContent = String(review);
}

function currentRows() {
  const search = normalize(/** @type {HTMLInputElement} */ ($('#directory-search')).value);
  const filter = directoryFilter;
  const sortBy = /** @type {HTMLSelectElement} */ ($('#directory-sort')).value;
  const rows = state.participants.filter(
    (row) =>
      (FILTERS[filter] ?? FILTERS.all)(row) &&
      (!search || normalize(row.displayName).includes(search) || row.aliases.some((/** @type {string} */ a) => normalize(a).includes(search))),
  );
  return rows.sort((a, b) =>
    sortBy === 'count' ? b.letterCount - a.letterCount || compareNames(a.displayName, b.displayName) : compareNames(a.displayName, b.displayName),
  );
}

/**
 * @param {any} row
 */
function printToggle(row) {
  const printed = row.printStatus === 'printed';
  // Printed before, with letters that arrived afterwards.
  const someNew = !printed && row.unprintedCount > 0 && row.unprintedCount < row.letterCount;
  return h('button', {
    type: 'button',
    class: `btn btn-sm print-toggle ${printed ? 'btn-success' : someNew ? 'btn-outline-warning' : 'btn-outline-secondary'}`,
    'aria-pressed': printed ? 'true' : 'false',
    title: printed
      ? 'Todas impresas. Pulsa para marcarlas como pendientes'
      : someNew
        ? `${plural(row.unprintedCount, 'carta nueva', 'cartas nuevas')} sin imprimir. Pulsa para marcar todas como impresas`
        : 'Pulsa para marcar todas como impresas',
    text: printed ? 'Impresa' : someNew ? `${row.unprintedCount} sin imprimir` : 'Pendiente',
    onClick: (/** @type {Event} */ event) =>
      void withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
        try {
          await api.updatePrintStatus([row.participantId], printed ? 'pending' : 'printed');
          emit('data-changed');
        } catch (error) {
          toastError(error);
        }
      }),
  });
}

function renderDirectory() {
  const rows = currentRows();
  const body = $('#directory-body');
  replaceChildren(
    body,
    rows.map((row) => {
      const selected = state.selection.has(row.participantId);
      const checkboxId = `select-${row.participantId}`;
      return h(
        'tr',
        { class: selected ? 'is-selected' : '' },
        h(
          'td',
          { class: 'col-check' },
          h('input', {
            class: 'form-check-input',
            type: 'checkbox',
            id: checkboxId,
            checked: selected,
            'aria-label': `Seleccionar a ${row.displayName}`,
            onChange: (/** @type {Event} */ event) => {
              if (/** @type {HTMLInputElement} */ (event.target).checked) state.selection.add(row.participantId);
              else state.selection.delete(row.participantId);
              renderDirectory();
            },
          }),
        ),
        h(
          'td',
          {},
          h('a', { class: 'participant-link', href: `#/participante/${encodeURIComponent(row.participantId)}`, text: row.displayName }),
          row.aliases.length > 0 ? h('div', { class: 'small text-body-secondary', text: `Alias: ${row.aliases.join(', ')}` }) : null,
        ),
        h(
          'td',
          { class: 'text-end' },
          h('span', {
            class: `badge rounded-pill count-badge ${row.letterCount === 0 ? 'text-bg-danger' : 'text-bg-secondary'}`,
            'aria-label': lettersLabel(row.letterCount),
            text: String(row.letterCount),
          }),
        ),
        h(
          'td',
          {},
          h(
            'div',
            { class: 'd-flex flex-wrap gap-1' },
            row.newCount > 0
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: 'news-button',
                    title: `${plural(row.newCount, 'carta nueva', 'cartas nuevas')} sin leer. Pulsa para marcarlas como leídas`,
                    'aria-label': `${plural(row.newCount, 'carta nueva', 'cartas nuevas')} de ${row.displayName}. Marcar como leídas`,
                    onClick: (/** @type {Event} */ event) => void markSeen({ participantId: row.participantId }, /** @type {HTMLButtonElement} */ (event.currentTarget)),
                  },
                  h('span', { class: 'envelope is-closed', 'aria-hidden': 'true' }),
                  `${row.newCount} ${row.newCount === 1 ? 'nueva' : 'nuevas'}`,
                )
              : null,
            row.warningCount > 0 ? h('span', { class: 'badge text-bg-warning', text: plural(row.warningCount, 'aviso', 'avisos') }) : null,
          ),
        ),
        h('td', {}, printToggle(row)),
      );
    }),
  );
  $('#directory-empty').hidden = rows.length > 0;
  $('#directory-summary').textContent = `${rows.length} de ${state.participants.length} participantes`;
  renderBatchBar();
}

function renderBatchBar() {
  const count = state.selection.size;
  const bar = $('#batch-bar');
  bar.hidden = count === 0;
  document.body.classList.toggle('has-batch-bar', count > 0);
  $('#batch-count').textContent = count === 1 ? '1 seleccionado' : `${count} seleccionados`;
}

/**
 * @param {any} data  Response of /api/letters/new
 */
function renderNovelties(data) {
  const list = $('#novelties-list');
  /** @type {HTMLButtonElement} */ ($('#mark-all-seen')).disabled = data.total === 0;
  if (data.total === 0) {
    replaceChildren(list, h('p', { class: 'text-body-secondary mb-0', text: 'No hay cartas nuevas.' }));
    return;
  }
  const groups = data.groups.map((/** @type {any} */ group) =>
    h(
      'div',
      { class: 'novelty-group' },
      h(
        'div',
        { class: 'd-flex justify-content-between align-items-center gap-2' },
        h(
          'a',
          { href: `#/participante/${encodeURIComponent(group.participant.id)}`, class: 'fw-semibold' },
          group.participant.displayName,
          ' ',
          h('span', { class: 'badge text-bg-info', text: `+${group.count}` }),
        ),
        h('button', {
          type: 'button',
          class: 'btn btn-link btn-sm p-0',
          text: 'Marcar como vistas',
          'aria-label': `Marcar como vistas las cartas de ${group.participant.displayName}`,
          onClick: (/** @type {Event} */ event) => void markSeen({ participantId: group.participant.id }, /** @type {HTMLButtonElement} */ (event.currentTarget)),
        }),
      ),
      h(
        'ul',
        {},
        group.letters.slice(0, 3).map((/** @type {any} */ letter) => h('li', { text: letter.subject || '(Sin asunto)' })),
        group.letters.length > 3 ? h('li', { class: 'text-body-secondary', text: `y ${group.letters.length - 3} más` }) : null,
      ),
    ),
  );
  const unassigned =
    data.unassigned.count > 0
      ? h(
          'div',
          { class: 'novelty-group' },
          h('a', { href: '#/revisar', class: 'fw-semibold' }, 'Sin asignar ', h('span', { class: 'badge text-bg-warning', text: `+${data.unassigned.count}` })),
          h('p', { class: 'small text-body-secondary mb-0', text: 'Revísalas en «Por revisar».' }),
        )
      : null;
  replaceChildren(list, groups, unassigned);
}

/**
 * @param {{ participantId?: string }} body
 * @param {HTMLButtonElement | null} button
 */
async function markSeen(body, button) {
  await withBusy(button, async () => {
    try {
      const result = await api.markSeen(body);
      toast(result.updated === 0 ? 'No había cartas nuevas.' : `${plural(result.updated, 'carta marcada', 'cartas marcadas')} como vista${result.updated === 1 ? '' : 's'}.`);
      emit('data-changed');
    } catch (error) {
      toastError(error);
    }
  });
}

export async function loadDashboard() {
  const [overview, fresh] = await Promise.all([api.dashboard(), api.newLetters()]);
  state.participants = overview.directory.rows;
  const known = new Set(state.participants.map((p) => p.participantId));
  for (const id of [...state.selection]) if (!known.has(id)) state.selection.delete(id);
  renderSteps(overview.kpis, overview.sync);
  renderDirectory();
  renderNovelties(fresh);
  emit('sync-status', overview.sync);
}

export function initDashboard() {
  $('#directory-search').addEventListener('input', debounce(renderDirectory, 150));
  for (const chip of document.querySelectorAll('#directory-filters [data-filter]')) {
    chip.addEventListener('click', () => {
      directoryFilter = /** @type {HTMLElement} */ (chip).dataset.filter ?? 'all';
      for (const other of document.querySelectorAll('#directory-filters [data-filter]')) {
        other.setAttribute('aria-pressed', other === chip ? 'true' : 'false');
      }
      renderDirectory();
    });
  }
  // Step 1 starts a search for new letters; step 3 prints, for everyone pending, only the
  // letters not printed yet (those who got new letters after printing get just the new ones).
  $('#step-sync').addEventListener('click', () => /** @type {HTMLButtonElement} */ ($('#sync-now-menu')).click());
  $('#step-print-pending').addEventListener('click', () => {
    const ids = state.participants.filter((row) => row.printStatus === 'pending' && row.letterCount > 0).map((row) => row.participantId);
    if (ids.length > 0) void printLetters(ids, null, { onlyUnprinted: true });
  });
  $('#directory-sort').addEventListener('change', renderDirectory);
  // "Sin cartas" KPI: show those participants in the list below.
  $('#kpi-zero-filter').addEventListener('click', () => {
    const chip = /** @type {HTMLButtonElement | null} */ (document.querySelector('#directory-filters [data-filter="without-letters"]'));
    chip?.click();
    $('#directory-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /** @param {(row: any) => boolean} predicate */
  const selectWhere = (predicate) => {
    for (const row of state.participants) if (predicate(row)) state.selection.add(row.participantId);
    renderDirectory();
  };
  $('#select-all').addEventListener('click', () => selectWhere(() => true));
  $('#select-with-letters').addEventListener('click', () => selectWhere((row) => row.letterCount > 0));
  $('#select-pending').addEventListener('click', () => selectWhere((row) => row.printStatus === 'pending'));
  const clearSelection = () => {
    state.selection.clear();
    renderDirectory();
  };
  $('#select-none').addEventListener('click', clearSelection);
  $('#batch-clear').addEventListener('click', clearSelection);

  for (const button of document.querySelectorAll('[data-export]')) {
    button.addEventListener('click', () => {
      const format = /** @type {'html' | 'txt' | 'json' | 'pdf'} */ (/** @type {HTMLElement} */ (button).dataset.export);
      void withBusy(/** @type {HTMLButtonElement} */ (button), () => exportLetters([...state.selection], format));
    });
  }
  $('#batch-print').addEventListener('click', () => void printLetters([...state.selection]));
  const includeAttachments = /** @type {HTMLInputElement} */ ($('#batch-include-attachments'));
  includeAttachments.checked = state.includeAttachments;
  includeAttachments.addEventListener('change', () => {
    state.includeAttachments = includeAttachments.checked;
  });
  const originalFormat = /** @type {HTMLInputElement} */ ($('#batch-original-format'));
  originalFormat.checked = state.originalFormat;
  originalFormat.addEventListener('change', () => {
    state.originalFormat = originalFormat.checked;
  });
  $('#mark-all-seen').addEventListener('click', (event) => void markSeen({}, /** @type {HTMLButtonElement} */ (event.currentTarget)));
}
