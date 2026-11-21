/**
 * Toasts, confirmation dialogs and the summary dialog (Bootstrap components).
 */
import { $, h, replaceChildren } from './dom.js';

/** @returns {any} */
const bs = () => /** @type {any} */ (window).bootstrap;

/**
 * @param {string} message
 * @param {'success' | 'danger' | 'warning' | 'info'} [variant]
 */
export function toast(message, variant = 'success') {
  const container = $('#toasts');
  const close = h('button', { type: 'button', class: 'btn-close btn-close-white me-2 m-auto', 'data-bs-dismiss': 'toast', 'aria-label': 'Cerrar' });
  const element = h(
    'div',
    {
      class: `toast align-items-center border-0 text-bg-${variant}`,
      role: variant === 'danger' ? 'alert' : 'status',
      'aria-live': variant === 'danger' ? 'assertive' : 'polite',
      'aria-atomic': 'true',
    },
    h('div', { class: 'd-flex' }, h('div', { class: 'toast-body', text: message }), close),
  );
  container.append(element);
  element.addEventListener('hidden.bs.toast', () => element.remove());
  bs().Toast.getOrCreateInstance(element, { delay: variant === 'danger' ? 10000 : 6000 }).show();
}

/**
 * @param {unknown} error
 */
export function toastError(error) {
  const message = error instanceof Error ? error.message : 'Se ha producido un error inesperado.';
  toast(message, 'danger');
}

/**
 * Promise-based confirmation dialog.
 * @param {{ title: string, body: string | Node, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} options
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', danger = false }) {
  const modalElement = $('#confirm-modal');
  $('#confirm-title').textContent = title;
  replaceChildren($('#confirm-body'), typeof body === 'string' ? h('p', { class: 'mb-0', text: body }) : body);
  const accept = /** @type {HTMLButtonElement} */ ($('#confirm-accept'));
  const cancel = $('#confirm-cancel');
  accept.textContent = confirmLabel;
  accept.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  cancel.textContent = cancelLabel;

  const modal = bs().Modal.getOrCreateInstance(modalElement);
  return new Promise((resolve) => {
    let accepted = false;
    const onAccept = () => {
      accepted = true;
      modal.hide();
    };
    const onHidden = () => {
      accept.removeEventListener('click', onAccept);
      modalElement.removeEventListener('hidden.bs.modal', onHidden);
      resolve(accepted);
    };
    accept.addEventListener('click', onAccept);
    modalElement.addEventListener('hidden.bs.modal', onHidden);
    modal.show();
  });
}

/**
 * @param {string} title
 * @param {Node} body
 */
export function showSummary(title, body) {
  $('#summary-title').textContent = title;
  replaceChildren($('#summary-body'), body);
  bs().Modal.getOrCreateInstance($('#summary-modal')).show();
}
