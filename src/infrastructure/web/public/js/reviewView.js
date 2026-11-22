/**
 * "Por revisar": letter preview, suggested participants as one-click buttons,
 * "Asignar" (choose participants) and "Dejar sin asignar". Below, the letters left
 * "Sin asignar", which can still be assigned (or returned to automatic assignment).
 */
import { api } from './api.js';
import { openAssignModal } from './assignModal.js';
import { $, enableTooltips, h, replaceChildren, withBusy } from './dom.js';
import { lettersLabel } from './format.js';
import { letterCard, letterToggleAllButtons } from './letterCard.js';
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
  const detected = letter.detectedRecipient;
  return [
    detected
      ? h(
          'div',
          { class: 'detected-recipient w-100 small' },
          h('span', { class: 'text-body-secondary', text: 'Destinatario detectado: ' }),
          h('strong', { text: detected.name }),
          !detected.canCreate
            ? null
            : h('button', {
                type: 'button',
                class: 'btn btn-sm btn-link py-0',
                text: `Crear participante «${detected.name}»`,
                onClick: () => openAssignModal(letter, () => emit('data-changed'), { newParticipantName: detected.name }),
              }),
        )
      : null,
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

/**
 * @param {any} letter
 */
function unassignedActions(letter) {
  const detected = letter.detectedRecipient;
  return [
    h('span', { class: 'small text-body-secondary align-self-center me-auto' }, 'Dejada sin asignar. No cuenta para nadie.', detected ? h('span', {}, ' Destinatario detectado: ', h('strong', { text: detected.name }), '.') : null),
    detected?.canCreate
      ? h('button', {
          type: 'button',
          class: 'btn btn-sm btn-outline-secondary',
          text: `Crear «${detected.name}»`,
          onClick: () => openAssignModal(letter, () => emit('data-changed'), { newParticipantName: detected.name }),
        })
      : null,
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-primary',
      text: 'Asignar…',
      onClick: () => openAssignModal(letter, () => emit('data-changed')),
    }),
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      text: 'Volver a automático',
      onClick: (/** @type {Event} */ event) =>
        void act(
          () => api.resetAssignment(letter.messageId),
          'La carta vuelve a la asignación automática.',
          /** @type {HTMLButtonElement} */ (event.currentTarget),
        ),
    }),
  ];
}

/**
 * @param {{ total: number, letters: any[] } | undefined} unassigned
 */
function renderUnassigned(unassigned) {
  const section = $('#unassigned-section');
  const total = unassigned?.total ?? 0;
  section.hidden = total === 0;
  $('#unassigned-count').textContent = total === 0 ? '' : lettersLabel(total);
  replaceChildren(
    $('#unassigned-list'),
    (unassigned?.letters ?? []).map((/** @type {any} */ letter) => letterCard(letter, { actions: unassignedActions(letter) })),
  );
}

/**
 * @param {{ total: number, letters: any[] } | undefined} withdrawn
 */
function renderWithdrawn(withdrawn) {
  const total = withdrawn?.total ?? 0;
  $('#withdrawn-section').hidden = total === 0;
  $('#withdrawn-count').textContent = total === 0 ? '' : lettersLabel(total);
  replaceChildren(
    $('#withdrawn-list'),
    (withdrawn?.letters ?? []).map((/** @type {any} */ letter) =>
      letterCard(letter, {
        showRecipients: true,
        actions: [
          h('span', { class: 'small text-body-secondary align-self-center me-auto', text: 'El destinatario está dado de baja.' }),
          h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Reasignar…', onClick: () => openAssignModal(letter, () => emit('data-changed')) }),
        ],
      }),
    ),
  );
}

export async function loadReview() {
  const queue = await api.reviewQueue();
  $('#review-count').textContent = queue.total === 0 ? '' : lettersLabel(queue.total);
  $('#nav-review-count').textContent = String(queue.total);
  $('#tab-review-count').textContent = String(queue.total);
  const list = $('#review-list');
  renderUnassigned(queue.unassigned);
  renderWithdrawn(queue.withdrawn);
  replaceChildren(
    $('#review-toggle-all'),
    queue.total + (queue.unassigned?.total ?? 0) > 1 ? letterToggleAllButtons(() => $('#view-review')) : null,
  );
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
