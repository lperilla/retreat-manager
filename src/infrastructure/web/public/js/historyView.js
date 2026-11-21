/**
 * "Historial de sincronizaciones": last runs (fecha, tipo, resultado, duración, error).
 */
import { api } from './api.js';
import { $, h, replaceChildren } from './dom.js';
import { formatDateTime, formatDuration } from './format.js';
import { RUN_STATUS_LABELS, RUN_TYPE_LABELS } from './labels.js';

export async function loadHistory() {
  const { runs } = await api.syncRuns(50);
  const variants = { success: 'text-bg-success', failed: 'text-bg-danger', running: 'text-bg-info' };
  replaceChildren(
    $('#history-body'),
    runs.map((/** @type {any} */ run) =>
      h(
        'tr',
        {},
        h('td', {}, h('time', { datetime: run.startedAt, text: formatDateTime(run.startedAt) })),
        h('td', { text: RUN_TYPE_LABELS[run.type] ?? run.type }),
        h('td', {}, h('span', { class: `badge ${variants[run.status] ?? 'text-bg-secondary'}`, text: RUN_STATUS_LABELS[run.status] ?? run.status })),
        h('td', { class: 'text-end', text: formatDuration(run.durationMs) }),
        h('td', { class: 'text-end', text: String(run.added) }),
        h('td', { class: 'text-end', text: String(run.updated) }),
        h('td', { class: 'text-end', text: String(run.deleted) }),
        h('td', { class: 'small text-break', text: run.error ?? '' }),
      ),
    ),
  );
  $('#history-empty').hidden = runs.length > 0;
}
