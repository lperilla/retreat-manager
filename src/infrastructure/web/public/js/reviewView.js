/**
 * "Por revisar": letter preview, suggested participants as one-click buttons,
 * "Asignar" (choose participants) and "Dejar sin asignar".
 */
import { api } from './api.js';
import { openAssignModal } from './assignModal.js';
import { $, enableTooltips, h, replaceChildren, withBusy } from './dom.js';
import { lettersLabel } from './format.js';
import { letterCard } from './letterCard.js';
import { SIGNAL_LABELS } from './labels.js';
import { emit } from './state.js';
import { toast, toastError } from './ui.js';

/**
 * @param {() => Promise<unknown>} action
 * @param {string} message
 * @param {HTMLButtonElement} button
 */
async function act(action, message, button) {
  await withBusy(button, async () => {
    try {
      await action();
      toast(message);
      emit('data-changed');
    } catch (error) {
      toastError(error);
    }
  });
}

/**
 * @param {any} letter
 */
function reviewActions(letter) {
  const suggestions = letter.assignment.suggestions.slice(0, 5).map((/** @type {any} */ suggestion) =>
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-primary',
      'data-bs-toggle': suggestion.matchedText ? 'tooltip' : null,
      'data-bs-title': suggestion.matchedText ? `${SIGNAL_LABELS[suggestion.signal] ?? ''}: «${suggestion.matchedText}»` : null,
      text: `Asignar a ${suggestion.displayName}`,
      onClick: (/** @type {Event} */ event) =>
        void act(
          () => api.assign(letter.messageId, [suggestion.id]),
          `Carta asignada a ${suggestion.displayName}.`,
          /** @type {HTMLButtonElement} */ (event.currentTarget),
        ),
    }),
  );
  return [
    h(
      'div',
      { class: 'suggestion-buttons d-flex flex-wrap gap-2 me-auto' },
      suggestions.length > 0 ? suggestions : h('span', { class: 'small text-body-secondary align-self-center', text: 'Sin sugerencias.' }),
    ),
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-primary',
      text: 'Asignar…',
      onClick: () => openAssignModal(letter, () => emit('data-changed')),
    }),
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      text: 'Dejar sin asignar',
      onClick: (/** @type {Event} */ event) =>
        void act(() => api.unassign(letter.messageId), 'La carta queda sin asignar.', /** @type {HTMLButtonElement} */ (event.currentTarget)),
    }),
  ];
}

export async function loadReview() {
  const queue = await api.reviewQueue();
  $('#review-count').textContent = queue.total === 0 ? '' : lettersLabel(queue.total);
  $('#nav-review-count').textContent = String(queue.total);
  const list = $('#review-list');
  if (queue.total === 0) {
    replaceChildren(list, h('div', { class: 'alert alert-success mb-0', role: 'status', text: 'No hay cartas pendientes de revisar.' }));
    return;
  }
  replaceChildren(
    list,
    queue.letters.map((/** @type {any} */ letter) => letterCard(letter, { actions: reviewActions(letter) })),
  );
  enableTooltips(list);
}
