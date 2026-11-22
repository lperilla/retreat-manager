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
 * @param {any[]} participants
 */
function nameLinks(participants) {
  return participants.slice(0, 4).map((/** @type {any} */ p, /** @type {number} */ index) => [
    index > 0 ? ', ' : null,
    h('a', { href: `#/participante/${encodeURIComponent(p.id)}`, text: p.displayName }),
  ]).concat(participants.length > 4 ? [` y ${participants.length - 4} más`] : []);
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
    pending.length === 0 ? `${plural(kpis.printedCount, 'participante impreso', 'participantes impresos')}` : `${lettersLabel(pending.reduce((sum, row) => sum + row.letterCount, 0))} por imprimir`;
  const printButton = /** @type {HTMLButtonElement} */ ($('#step-print-pending'));
  printButton.disabled = pending.length === 0;

  const line = [];
  if (kpis.mostLetters.participants.length > 0) line.push(['Más cartas: ', h('strong', {}, nameLinks(kpis.mostLetters.participants)), ` (${kpis.mostLetters.count})`]);
  if (kpis.participantCount > 0) {
    line.push(
      kpis.zeroLetterParticipants.length > 0
        ? [h('span', { class: 'zero-letters', text: 'Sin cartas: ' }), h('strong', {}, nameLinks(kpis.zeroLetterParticipants))]
        : ['Todos tienen cartas'],
    );
  }
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
  // Step 1 starts a search for new letters; step 3 prints everyone pending with letters.
  $('#step-sync').addEventListener('click', () => /** @type {HTMLButtonElement} */ ($('#sync-now')).click());
  $('#step-print-pending').addEventListener('click', () => {
    const ids = state.participants.filter((row) => row.printStatus === 'pending' && row.letterCount > 0).map((row) => row.participantId);
    if (ids.length > 0) void printLetters(ids);
  });
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
