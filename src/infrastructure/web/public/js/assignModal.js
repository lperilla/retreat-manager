/**
 * Manual assignment dialog: assign / reassign to one or more participants, leave the letter
 * unassigned, or return it to automatic assignment.
 */
import { api } from './api.js';
import { $, h, replaceChildren, withBusy } from './dom.js';
import { compareNames, normalize, senderName } from './format.js';
import { state } from './state.js';
import { toast, toastError } from './ui.js';

/** @type {any} */
let current = null;
/** @type {(() => void) | null} */
let onDone = null;

function renderOptions() {
  const search = normalize(/** @type {HTMLInputElement} */ ($('#assign-search')).value);
  const selected = new Set(current?.selected ?? []);
  const participants = [...state.participants]
    .sort((a, b) => compareNames(a.displayName, b.displayName))
    .filter((p) => !search || normalize(p.displayName).includes(search) || p.aliases.some((alias) => normalize(alias).includes(search)));

  replaceChildren(
    $('#assign-options'),
    participants.length === 0
      ? h('p', { class: 'text-body-secondary small mb-0', text: 'No hay participantes que coincidan.' })
      : participants.map((p) => {
          const id = `assign-${p.participantId}`;
          const input = h('input', {
            class: 'form-check-input',
            type: 'checkbox',
            id,
            value: p.participantId,
            checked: selected.has(p.participantId),
            onChange: (/** @type {Event} */ event) => {
              const target = /** @type {HTMLInputElement} */ (event.target);
              if (target.checked) current.selected.add(target.value);
              else current.selected.delete(target.value);
            },
          });
          const suggestion = current.suggestions.has(p.participantId) ? h('span', { class: 'badge text-bg-warning ms-2', text: 'Sugerido' }) : null;
          return h('div', { class: 'form-check' }, input, h('label', { class: 'form-check-label', for: id }, p.displayName, suggestion));
        }),
  );
}

/**
 * @param {() => Promise<unknown>} action
 * @param {string} message
 * @param {HTMLButtonElement} button
 */
async function run(action, message, button) {
  try {
    await withBusy(button, action);
    /** @type {any} */ (window).bootstrap.Modal.getOrCreateInstance($('#assign-modal')).hide();
    toast(message);
    onDone?.();
  } catch (error) {
    toastError(error);
  }
}

export function initAssignModal() {
  $('#assign-search').addEventListener('input', renderOptions);
  $('#assign-save').addEventListener('click', (event) => {
    const ids = [...(current?.selected ?? [])];
    if (ids.length === 0) {
      toast('Selecciona al menos un participante o usa «Dejar sin asignar».', 'warning');
      return;
    }
    void run(() => api.assign(current.messageId, ids), 'Carta asignada.', /** @type {HTMLButtonElement} */ (event.currentTarget));
  });
  $('#assign-unassign').addEventListener('click', (event) => {
    void run(() => api.unassign(current.messageId), 'La carta queda sin asignar.', /** @type {HTMLButtonElement} */ (event.currentTarget));
  });
  $('#assign-reset').addEventListener('click', (event) => {
    void run(
      () => api.resetAssignment(current.messageId),
      'La carta vuelve a la asignación automática.',
      /** @type {HTMLButtonElement} */ (event.currentTarget),
    );
  });
}

/**
 * @param {any} letter  Letter view from the API.
 * @param {() => void} done  Called after a successful change.
 */
export function openAssignModal(letter, done) {
  current = {
    messageId: letter.messageId,
    selected: new Set(letter.assignment.participants.map((/** @type {any} */ p) => p.id)),
    suggestions: new Set(letter.assignment.suggestions.map((/** @type {any} */ s) => s.id)),
  };
  onDone = done;
  $('#assign-letter').textContent = `«${letter.subject || '(Sin asunto)'}» · De: ${senderName(letter.from)}`;
  /** @type {HTMLInputElement} */ ($('#assign-search')).value = '';
  /** @type {HTMLButtonElement} */ ($('#assign-reset')).hidden = !letter.assignment.manual;
  renderOptions();
  /** @type {any} */ (window).bootstrap.Modal.getOrCreateInstance($('#assign-modal')).show();
}
