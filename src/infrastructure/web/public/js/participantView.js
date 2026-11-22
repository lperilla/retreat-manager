/**
 * Participant letters: one compact toolbar (print with its options and exports, print
 * status, date filter) and the letters as a quiet inbox-like list.
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
  document.title = `${participant.displayName} · Gestión del retiro`;

  const printed = data.printStatus.status === 'printed';
  const everPrinted = (data.printStatus.printedCount ?? 0) > 0;
  const menuId = `print-menu-${participant.id}`;
  // Letters on screen not printed yet: "Imprimir nuevas" prints exactly these.
  const unprintedIds = data.letters.filter((/** @type {any} */ l) => !l.printed).map((/** @type {any} */ l) => l.messageId);
  const offerNew = unprintedIds.length > 0 && unprintedIds.length < data.letters.length;
  const printAll = () => void printLetters([participant.id], afterDate);
  const printNew = () => void printLetters([participant.id], afterDate, { messageIds: unprintedIds });

  /** @param {string} id @param {string} label @param {boolean} checked @param {(on: boolean) => void} onChange @param {string} [title] */
  const optionSwitch = (id, label, checked, onChange, title) =>
    h(
      'div',
      { class: 'form-check form-switch mb-1', title },
      h('input', {
        class: 'form-check-input',
        type: 'checkbox',
        role: 'switch',
        id,
        checked,
        onChange: (/** @type {Event} */ event) => onChange(/** @type {HTMLInputElement} */ (event.target).checked),
      }),
      h('label', { class: 'form-check-label', for: id, text: label }),
    );

  const menuToggle = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-sm btn-primary dropdown-toggle dropdown-toggle-split',
      id: menuId,
      'data-bs-toggle': 'dropdown',
      'data-bs-auto-close': 'outside',
      'aria-expanded': 'false',
    },
    h('span', { class: 'visually-hidden', text: 'Opciones de impresión y exportación' }),
  );
  const closeMenu = () => /** @type {any} */ (window).bootstrap?.Dropdown.getOrCreateInstance(menuToggle).hide();

  const printMenu = h(
    'div',
    { class: 'btn-group' },
    offerNew
      ? h('button', {
          type: 'button',
          class: 'btn btn-sm btn-primary',
          text: `Imprimir nuevas (${unprintedIds.length})`,
          title: 'Imprime solo las cartas que todavía no se han impreso',
          onClick: printNew,
        })
      : h('button', { type: 'button', class: 'btn btn-sm btn-primary', text: 'Imprimir', onClick: printAll }),
    menuToggle,
    h(
      'div',
      { class: 'dropdown-menu batch-options', 'aria-labelledby': menuId },
      offerNew
        ? [
            h('button', {
              type: 'button',
              class: 'dropdown-item px-0',
              text: `Imprimir todas (${data.letters.length})`,
              onClick: () => {
                closeMenu();
                printAll();
              },
            }),
            h('hr', { class: 'dropdown-divider' }),
          ]
        : null,
      h('h6', { class: 'dropdown-header px-0', text: 'Al imprimir y exportar' }),
      optionSwitch('participant-include-attachments', 'Incluir adjuntos', state.includeAttachments, (on) => {
        state.includeAttachments = on;
        const batchSwitch = /** @type {HTMLInputElement | null} */ (document.getElementById('batch-include-attachments'));
        if (batchSwitch) batchSwitch.checked = on;
      }),
      optionSwitch(
        'participant-original-format',
        'Formato original',
        state.originalFormat,
        (on) => {
          state.originalFormat = on;
          const batchSwitch = /** @type {HTMLInputElement | null} */ (document.getElementById('batch-original-format'));
          if (batchSwitch) batchSwitch.checked = on;
        },
        'Mantiene los colores, fuentes y tamaños de cada correo al imprimir y exportar a .html',
      ),
      h('hr', { class: 'dropdown-divider' }),
      h('h6', { class: 'dropdown-header px-0', text: 'Exportar' }),
      ['html', 'txt', 'json', 'pdf'].map((format) =>
        h('button', {
          type: 'button',
          class: 'dropdown-item px-0',
          text: format === 'pdf' ? 'PDF de adjuntos (.pdf)' : `Archivo .${format}`,
          onClick: () => {
            closeMenu();
            void exportLetters([participant.id], /** @type {any} */ (format), afterDate);
          },
        }),
      ),
    ),
  );

  const unprintedTotal = data.printStatus.unprintedCount ?? 0;
  const printToggle = h('button', {
    type: 'button',
    class: `btn btn-sm ${printed ? 'btn-success' : 'btn-outline-secondary'}`,
    'aria-pressed': printed ? 'true' : 'false',
    text: printed ? 'Impresa ✓' : everPrinted ? `${plural(unprintedTotal, 'carta sin imprimir', 'cartas sin imprimir')}` : 'Pendiente de imprimir',
    title: printed ? 'Marcar todas como no impresas' : 'Marcar todas como impresas',
    onClick: (/** @type {Event} */ event) =>
      void withBusy(/** @type {HTMLButtonElement} */ (event.currentTarget), async () => {
        try {
          await api.updatePrintStatus([participant.id], printed ? 'pending' : 'printed');
          emit('data-changed');
        } catch (error) {
          toastError(error);
        }
      }),
  });

  const reload = () => void loadParticipant(participant.id).catch(toastError);
  const dateFilter = h(
    'div',
    { class: 'd-flex align-items-center gap-2' },
    h('label', { class: 'small text-body-secondary text-nowrap', for: 'after-date', text: 'Desde el día' }),
    h('input', {
      type: 'date',
      class: 'form-control form-control-sm w-auto',
      id: 'after-date',
      value: afterDate ?? '',
      title: 'Muestra solo las cartas posteriores a ese día',
      onChange: (/** @type {Event} */ event) => {
        afterDate = /** @type {HTMLInputElement} */ (event.target).value || null;
        reload();
      },
    }),
    afterDate
      ? h('button', {
          type: 'button',
          class: 'btn btn-sm btn-link px-1 text-decoration-none',
          'aria-label': 'Quitar el filtro de fecha',
          title: 'Quitar el filtro de fecha',
          text: '✕',
          onClick: () => {
            afterDate = null;
            reload();
          },
        })
      : null,
  );

  const controls = h(
    'div',
    { class: 'participant-controls d-flex flex-wrap gap-2 align-items-center mb-3' },
    printMenu,
    printToggle,
    h(
      'div',
      { class: 'd-flex flex-wrap gap-3 align-items-center ms-md-auto' },
      data.newCount > 0
        ? h('button', {
            type: 'button',
            class: 'btn btn-sm btn-link px-0 text-decoration-none',
            text: 'Marcar como vistas',
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
          })
        : null,
      dateFilter,
      data.letters.length > 1 ? letterToggleAllButtons(() => view) : null,
    ),
  );

  const letters =
    data.letters.length === 0
      ? h('p', { class: 'letter-list-empty', text: afterDate ? 'No hay cartas posteriores a esa fecha.' : 'Este participante todavía no tiene cartas.' })
      : data.letters.map((/** @type {any} */ letter) => lettersCardWithActions(letter, participant.id, everPrinted, reload));

  replaceChildren(
    view,
    h('nav', { class: 'mt-3 mb-2 no-print small', 'aria-label': 'Ruta' }, h('a', { class: 'text-decoration-none', href: '#/', text: '← Panel' })),
    h(
      'div',
      { class: 'print-participant' },
      h(
        'header',
        { class: 'mb-3' },
        h('h1', { class: 'h4 mb-1', id: 'participant-title', text: participant.displayName }),
        h(
          'p',
          { class: 'small text-body-secondary mb-0' },
          lettersLabel(data.total),
          data.newCount > 0 ? ` · ${plural(data.newCount, 'nueva', 'nuevas')}` : '',
          participant.aliases.length > 0 ? ` · Alias: ${participant.aliases.join(', ')}` : '',
          printed && data.printStatus.printedAt ? ` · Impresa el ${formatDateTime(data.printStatus.printedAt)}` : '',
        ),
      ),
      controls,
      h('div', { class: 'letter-list' }, letters),
    ),
  );
  enableTooltips(view);
}

/**
 * @param {any} letter
 * @param {string} participantId
 * @param {boolean} everPrinted  Some letter of this participant was printed before.
 * @param {() => void} reload
 */
function lettersCardWithActions(letter, participantId, everPrinted, reload) {
  return letterCard(letter, {
    // The page is about this participant: name the others only when the letter is shared.
    showRecipients: letter.assignment.participants.length > 1,
    actionsWhenOpen: true,
    print: {
      printed: letter.printed === true,
      highlight: everPrinted,
      onToggle: (button) =>
        void withBusy(button, async () => {
          try {
            await api.updatePrintStatus([participantId], letter.printed ? 'pending' : 'printed', [letter.messageId]);
            emit('data-changed');
          } catch (error) {
            toastError(error);
          }
        }),
    },
    actions: [
      h('button', {
        type: 'button',
        class: 'btn btn-sm btn-outline-primary',
        text: 'Imprimir esta carta',
        onClick: () => void printLetters([participantId], null, { messageIds: [letter.messageId] }),
      }),
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
