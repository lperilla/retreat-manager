/**
 * Dashboard: KPIs, participant directory (selection, search, filters, sort, badges),
 * novelties panel, review summary and the batch bar.
 */
import { api } from './api.js';
import { $, debounce, h, replaceChildren, withBusy } from './dom.js';
import { compareNames, lettersLabel, normalize, plural } from './format.js';
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

/**
 * @param {HTMLElement} element
 * @param {any[]} participants
 * @param {{ highlightZero?: boolean, count?: number }} [options]
 */
function renderNames(element, participants, { highlightZero = false, count = 0 } = {}) {
  if (participants.length === 0) {
    replaceChildren(element, '—');
    return;
  }
  const links = participants.map((p, index) => [
    index > 0 ? ', ' : null,
    h('a', { href: `#/participante/${encodeURIComponent(p.id)}`, class: highlightZero && count === 0 ? 'zero-letters' : '', text: p.displayName }),
  ]);
  replaceChildren(element, links);
}

/**
 * @param {any} kpis
 */
function renderKpis(kpis) {
  $('#kpi-total').textContent = String(kpis.totalLetters);
  $('#kpi-with-letters').textContent = `${kpis.participantsWithLetters} de ${kpis.participantCount}`;
  $('#kpi-with-letters-detail').textContent =
    kpis.participantsWithoutLetters > 0 ? `${plural(kpis.participantsWithoutLetters, 'participante', 'participantes')} sin cartas` : 'Todos tienen cartas';

  const most = $('#kpi-most');
  most.classList.add('kpi-names');
  renderNames(most, kpis.mostLetters.participants);
  $('#kpi-most-detail').textContent = kpis.mostLetters.participants.length > 0 ? lettersLabel(kpis.mostLetters.count) : 'Aún no hay cartas';

  const fewest = $('#kpi-fewest');
  fewest.classList.add('kpi-names');
  renderNames(fewest, kpis.fewestLetters.participants, { highlightZero: true, count: kpis.fewestLetters.count });
  const fewestDetail = $('#kpi-fewest-detail');
  fewestDetail.className = `kpi-detail${kpis.fewestLetters.count === 0 && kpis.participantCount > 0 ? ' zero-letters' : ''}`;
  fewestDetail.textContent =
    kpis.participantCount === 0 ? '' : kpis.fewestLetters.count === 0 ? 'Sin ninguna carta' : lettersLabel(kpis.fewestLetters.count);

  $('#kpi-review').textContent = String(kpis.reviewQueueSize);
  $('#kpi-new').textContent = String(kpis.newLettersCount);
  $('#nav-review-count').textContent = String(kpis.reviewQueueSize);
  $('#tab-review-count').textContent = String(kpis.reviewQueueSize);
}

function currentRows() {
  const search = normalize(/** @type {HTMLInputElement} */ ($('#directory-search')).value);
  const filter = /** @type {HTMLSelectElement} */ ($('#directory-filter')).value;
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
  return h('button', {
    type: 'button',
    class: `btn btn-sm print-toggle ${printed ? 'btn-success' : 'btn-outline-secondary'}`,
    'aria-pressed': printed ? 'true' : 'false',
    title: printed ? 'Marcar como pendiente' : 'Marcar como impresa',
    text: printed ? 'Impresa' : 'Pendiente',
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
            row.newCount > 0 ? h('span', { class: 'badge text-bg-info', text: `+${row.newCount} ${row.newCount === 1 ? 'nueva' : 'nuevas'}` }) : null,
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

/**
 * @param {any} queue
 */
function renderReviewSummary(queue) {
  const container = $('#review-summary');
  if (queue.total === 0) {
    replaceChildren(container, h('p', { class: 'text-body-secondary mb-0', text: 'No hay cartas pendientes de revisar.' }));
    return;
  }
  replaceChildren(
    container,
    h('p', { class: 'mb-2' }, h('strong', { text: lettersLabel(queue.total) }), ' sin asignar con seguridad.'),
    h(
      'ul',
      { class: 'small mb-0 ps-3' },
      queue.letters.slice(0, 4).map((/** @type {any} */ letter) => h('li', { text: letter.subject || '(Sin asunto)' })),
    ),
  );
}

export async function loadDashboard() {
  const [overview, fresh, queue] = await Promise.all([api.dashboard(), api.newLetters(), api.reviewQueue()]);
  state.participants = overview.directory.rows;
  const known = new Set(state.participants.map((p) => p.participantId));
  for (const id of [...state.selection]) if (!known.has(id)) state.selection.delete(id);
  renderKpis(overview.kpis);
  renderDirectory();
  renderNovelties(fresh);
  renderReviewSummary(queue);
  emit('sync-status', overview.sync);
}

export function initDashboard() {
  $('#directory-search').addEventListener('input', debounce(renderDirectory, 150));
  $('#directory-filter').addEventListener('change', renderDirectory);
  $('#directory-sort').addEventListener('change', renderDirectory);

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
