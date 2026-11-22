/**
 * Participant detail: chronological letters with assignment badges and flags, and
 * "Imprimir" / "Exportar" for this participant only.
 */
import { api } from './api.js';
import { openAssignModal } from './assignModal.js';
import { $, enableTooltips, h, replaceChildren, withBusy } from './dom.js';
import { formatDateTime, lettersLabel, plural } from './format.js';
import { exportLetters, printLetters } from './exportActions.js';
import { letterCard, letterToggleAllButtons } from './letterCard.js';
import { emit, state } from './state.js';
import { toast, toastError } from './ui.js';

/** @type {string | null} */
let afterDate = null;
/** @type {string | null} */
let currentId = null;

/**
 * @param {string} participantId
 */
export async function loadParticipant(participantId) {
  if (participantId !== currentId) afterDate = null;
  currentId = participantId;
  const view = $('#view-participant');
  const data = await api.participantLetters(participantId, afterDate);
  const { participant } = data;
  document.title = `${participant.displayName} · Cartas del retiro`;

  const printed = data.printStatus.status === 'printed';
  const exportMenuId = `export-menu-${participant.id}`;

  const controls = h(
    'div',
    { class: 'participant-controls d-flex flex-wrap gap-2 align-items-end mb-3' },
    h('button', {
      type: 'button',
      class: 'btn btn-primary',
      text: 'Imprimir',
      onClick: () => void printLetters([participant.id], afterDate),
    }),
    h(
      'div',
      { class: 'btn-group' },
      h('button', {
        type: 'button',
        class: 'btn btn-outline-primary dropdown-toggle',
        id: exportMenuId,
        'data-bs-toggle': 'dropdown',
        'aria-expanded': 'false',
        text: 'Exportar',
      }),
      h(
        'ul',
        { class: 'dropdown-menu', 'aria-labelledby': exportMenuId },
        ['html', 'txt', 'json', 'pdf'].map((format) =>
          h(
            'li',
            {},
            h('button', {
              type: 'button',
              class: 'dropdown-item',
              text: format === 'pdf' ? 'PDF de adjuntos (.pdf)' : `Exportar .${format}`,
              onClick: () => void exportLetters([participant.id], /** @type {any} */ (format), afterDate),
            }),
          ),
        ),
      ),
    ),
    h('button', {
      type: 'button',
      class: `btn ${printed ? 'btn-success' : 'btn-outline-secondary'}`,
      'aria-pressed': printed ? 'true' : 'false',
      text: printed ? 'Impresa' : 'Pendiente de imprimir',
      title: printed ? 'Marcar como pendiente' : 'Marcar como impresa',
      onClick: (/** @type {Event} */ event) =>
        void withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
          try {
            await api.updatePrintStatus([participant.id], printed ? 'pending' : 'printed');
            emit('data-changed');
          } catch (error) {
            toastError(error);
          }
        }),
    }),
    h(
      'div',
      { class: 'form-check form-switch align-self-center mb-0' },
      h('input', {
        class: 'form-check-input',
        type: 'checkbox',
        role: 'switch',
        id: 'participant-include-attachments',
        checked: state.includeAttachments,
        onChange: (/** @type {Event} */ event) => {
          state.includeAttachments = /** @type {HTMLInputElement} */ (event.target).checked;
          const batchSwitch = /** @type {HTMLInputElement | null} */ (document.getElementById('batch-include-attachments'));
          if (batchSwitch) batchSwitch.checked = state.includeAttachments;
        },
      }),
      h('label', { class: 'form-check-label', for: 'participant-include-attachments', text: 'Incluir adjuntos' }),
    ),
    h(
      'div',
      { class: 'form-check form-switch align-self-center mb-0' },
      h('input', {
        class: 'form-check-input',
        type: 'checkbox',
        role: 'switch',
        id: 'participant-original-format',
        checked: state.originalFormat,
        onChange: (/** @type {Event} */ event) => {
          state.originalFormat = /** @type {HTMLInputElement} */ (event.target).checked;
          const batchSwitch = /** @type {HTMLInputElement | null} */ (document.getElementById('batch-original-format'));
          if (batchSwitch) batchSwitch.checked = state.originalFormat;
        },
      }),
      h('label', {
        class: 'form-check-label',
        for: 'participant-original-format',
        title: 'Mantiene los colores, fuentes y tamaños de cada correo al imprimir y exportar a .html',
        text: 'Formato original',
      }),
    ),
    h('button', {
      type: 'button',
      class: 'btn btn-outline-secondary',
      text: 'Marcar como vistas',
      disabled: data.newCount === 0,
      onClick: (/** @type {Event} */ event) =>
        void withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
          try {
            await api.markSeen({ participantId: participant.id });
            toast('Cartas marcadas como vistas.');
            emit('data-changed');
          } catch (error) {
            toastError(error);
          }
        }),
    }),
    h(
      'form',
      {
        class: 'd-flex flex-wrap gap-2 align-items-end ms-md-auto',
        onSubmit: (/** @type {Event} */ event) => {
          event.preventDefault();
          const value = /** @type {HTMLInputElement} */ ($('#after-date', view)).value;
          afterDate = value || null;
          void loadParticipant(participant.id).catch(toastError);
        },
      },
      h(
        'div',
        {},
        h('label', { class: 'form-label small mb-1', for: 'after-date', text: 'Mostrar cartas posteriores al día' }),
        h('input', { type: 'date', class: 'form-control form-control-sm', id: 'after-date', value: afterDate ?? '' }),
      ),
      h('button', { type: 'submit', class: 'btn btn-sm btn-outline-secondary', text: 'Aplicar' }),
      afterDate
        ? h('button', {
            type: 'button',
            class: 'btn btn-sm btn-link',
            text: 'Quitar filtro',
            onClick: () => {
              afterDate = null;
              void loadParticipant(participant.id).catch(toastError);
            },
          })
        : null,
    ),
  );

  const letters =
    data.letters.length === 0
      ? h('p', { class: 'text-body-secondary', text: afterDate ? 'No hay cartas posteriores a esa fecha.' : 'Este participante todavía no tiene cartas.' })
      : data.letters.map((/** @type {any} */ letter) =>
          lettersCardWithActions(letter, () => void loadParticipant(participant.id).catch(toastError)),
        );

  replaceChildren(
    view,
    h('nav', { class: 'my-3 no-print', 'aria-label': 'Ruta' }, h('a', { href: '#/', text: '← Volver al panel' })),
    h(
      'div',
      { class: 'print-participant' },
      h(
        'header',
        { class: 'mb-3' },
        h('h1', { class: 'h3 mb-1', id: 'participant-title', text: participant.displayName }),
        h(
          'p',
          { class: 'text-body-secondary mb-0' },
          lettersLabel(data.total),
          data.newCount > 0 ? ` · ${plural(data.newCount, 'nueva', 'nuevas')}` : '',
          participant.aliases.length > 0 ? ` · Alias: ${participant.aliases.join(', ')}` : '',
          printed && data.printStatus.printedAt ? ` · Impresa el ${formatDateTime(data.printStatus.printedAt)}` : '',
        ),
      ),
      controls,
      data.letters.length > 1
        ? h('div', { class: 'd-flex justify-content-end mb-2' }, letterToggleAllButtons(() => view))
        : null,
      letters,
    ),
  );
  enableTooltips(view);
}

/**
 * @param {any} letter
 * @param {() => void} reload
 */
function lettersCardWithActions(letter, reload) {
  return letterCard(letter, {
    showRecipients: true,
    actions: [
      h('button', {
        type: 'button',
        class: 'btn btn-sm btn-outline-secondary',
        text: 'Reasignar…',
        onClick: () =>
          openAssignModal(letter, () => {
            emit('data-changed');
            reload();
          }),
      }),
    ],
  });
}
