/**
 * Manual assignment dialog: assign / reassign to one or more participants, leave the letter
 * unassigned, or return it to automatic assignment. A participant missing from the list
 * (letters keep arriving) can be added from here and is selected for the letter.
 */
import { api } from './api.js';
import { $, h, replaceChildren, withBusy } from './dom.js';
import { compareNames, normalize, senderName } from './format.js';
import { emit, state } from './state.js';
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
      ? h(
          'p',
          { class: 'text-body-secondary small mb-0' },
          'No hay participantes que coincidan. ',
          search
            ? h('button', {
                type: 'button',
                class: 'btn btn-link btn-sm p-0 align-baseline',
                text: `Añadir «${/** @type {HTMLInputElement} */ ($('#assign-search')).value.trim()}» como participante`,
                onClick: () => showNewParticipantForm(/** @type {HTMLInputElement} */ ($('#assign-search')).value.trim()),
              })
            : null,
        )
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

/**
 * @param {string} [name]
 */
function showNewParticipantForm(name = '') {
  const form = /** @type {HTMLFormElement} */ ($('#new-participant-form'));
  form.hidden = false;
  $('#new-participant-toggle').setAttribute('aria-expanded', 'true');
  const input = /** @type {HTMLInputElement} */ ($('#new-participant-name'));
  if (name) input.value = name;
  input.focus();
}

function hideNewParticipantForm() {
  const form = /** @type {HTMLFormElement} */ ($('#new-participant-form'));
  form.hidden = true;
  form.reset();
  $('#new-participant-toggle').setAttribute('aria-expanded', 'false');
}

/**
 * @param {SubmitEvent} event
 */
async function createParticipant(event) {
  event.preventDefault();
  const name = /** @type {HTMLInputElement} */ ($('#new-participant-name')).value.trim();
  if (!name) {
    toast('Escribe el nombre del participante.', 'warning');
    return;
  }
  const aliases = /** @type {HTMLInputElement} */ ($('#new-participant-aliases'))
    .value.split(',')
    .map((alias) => alias.trim())
    .filter(Boolean);
  try {
    await withBusy(/** @type {HTMLButtonElement} */ ($('#new-participant-create')), async () => {
      const result = await api.addParticipant({ displayName: name, aliases });
      const { participant, recompute } = result;
      state.participants = [
        ...state.participants,
        { participantId: participant.id, displayName: participant.displayName, aliases: participant.aliases, letterCount: 0 },
      ];
      current?.selected.add(participant.id);
      /** @type {HTMLInputElement} */ ($('#assign-search')).value = '';
      hideNewParticipantForm();
      renderOptions();
      const others = recompute.assignedToNew > 0 ? ` Además se le han asignado ${recompute.assignedToNew} carta(s) pendiente(s).` : '';
      toast(`${participant.displayName} añadido a los participantes. Pulsa «Asignar» para asignarle esta carta.${others}`);
      emit('data-changed');
    });
  } catch (error) {
    toastError(error);
  }
}

export function initAssignModal() {
  $('#new-participant-toggle').addEventListener('click', () => {
    if (/** @type {HTMLFormElement} */ ($('#new-participant-form')).hidden) showNewParticipantForm();
    else hideNewParticipantForm();
  });
  $('#new-participant-form').addEventListener('submit', (event) => void createParticipant(/** @type {SubmitEvent} */ (event)));
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
  hideNewParticipantForm();
  /** @type {HTMLButtonElement} */ ($('#assign-reset')).hidden = !letter.assignment.manual;
  renderOptions();
  /** @type {any} */ (window).bootstrap.Modal.getOrCreateInstance($('#assign-modal')).show();
}
