/**
 * Attachment rendering inside letter cards: image thumbnails, "Abrir PDF" with preview,
 * DOCX text shown as part of the letter, inline `cid:` images and fallback cards
 * ("Adjunto no imprimible", blocked, too large).
 */
import { api } from './api.js';
import { h } from './dom.js';
import { formatBytes } from './format.js';
import { state } from './state.js';

const CID_MARKER = /\[cid:([^\]\s]+)\]/gi;

/**
 * @param {string} messageId
 * @param {number} index
 * @param {{ variant?: 'original' | 'display' | 'thumbnail', download?: boolean }} [options]
 */
export function attachmentUrl(messageId, index, { variant = 'original', download = false } = {}) {
  const params = new URLSearchParams({ variant });
  if (download) params.set('download', '1');
  return `/api/letters/${encodeURIComponent(messageId)}/attachments/${index}?${params.toString()}`;
}

/** @param {any} attachment */
function tooLarge(attachment) {
  const limit = (state.info?.maxAttachmentMb ?? 15) * 1024 * 1024;
  return attachment.size > limit;
}

/**
 * @param {string} title
 * @param {string} detail
 * @param {Node[]} [actions]
 * @param {string} [variant]
 */
function card(title, detail, actions = [], variant = 'secondary') {
  return h(
    'div',
    { class: `attachment-card border-${variant}` },
    h('div', { class: 'fw-semibold', text: title }),
    h('div', { class: 'small text-body-secondary text-break', text: detail }),
    actions.length > 0 ? h('div', { class: 'd-flex flex-wrap gap-2 mt-2 no-print' }, actions) : null,
  );
}

/**
 * @param {string} href
 * @param {string} label
 * @param {{ newTab?: boolean, download?: boolean }} [options]
 */
function linkButton(href, label, { newTab = false, download = false } = {}) {
  return h('a', {
    class: 'btn btn-sm btn-outline-secondary',
    href,
    text: label,
    target: newTab ? '_blank' : null,
    rel: newTab ? 'noopener' : null,
    download: download ? '' : null,
  });
}

/**
 * @param {any} letter
 * @param {any} attachment
 * @param {string} className
 */
function imageFigure(letter, attachment, className) {
  const display = attachmentUrl(letter.messageId, attachment.index, { variant: 'display' });
  const img = h('img', {
    src: attachmentUrl(letter.messageId, attachment.index, { variant: 'thumbnail' }),
    alt: `Imagen adjunta: ${attachment.filename}`,
    loading: 'lazy',
  });
  const figure = h(
    'figure',
    { class: className },
    h('a', { href: display, target: '_blank', rel: 'noopener', title: 'Ver la imagen a tamaño completo' }, img),
    h('figcaption', { class: 'small text-body-secondary', text: attachment.filename }),
  );
  img.addEventListener(
    'error',
    () => {
      figure.replaceWith(
        card('No se ha podido mostrar la imagen', `${attachment.filename} · ${formatBytes(attachment.size)}`, [
          linkButton(attachmentUrl(letter.messageId, attachment.index, { download: true }), 'Descargar original', { download: true }),
        ], 'warning'),
      );
    },
    { once: true },
  );
  return figure;
}

/**
 * @param {any} letter
 * @param {any} attachment
 */
function pdfCard(letter, attachment) {
  const href = attachmentUrl(letter.messageId, attachment.index);
  const container = h('div', { class: 'pdf-preview-container no-print' });
  const toggle = h('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', 'aria-expanded': 'false', text: 'Vista previa' });
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    if (open) {
      container.replaceChildren();
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Vista previa';
    } else {
      container.replaceChildren(h('iframe', { class: 'pdf-preview', src: href, title: `Vista previa de ${attachment.filename}` }));
      toggle.setAttribute('aria-expanded', 'true');
      toggle.textContent = 'Ocultar vista previa';
    }
  });
  return h(
    'div',
    {},
    card('PDF adjunto', `${attachment.filename} · ${formatBytes(attachment.size)} · imprímelo aparte`, [
      h('a', { class: 'btn btn-sm btn-primary', href, target: '_blank', rel: 'noopener', text: 'Abrir PDF' }),
      toggle,
    ]),
    container,
  );
}

/**
 * @param {any} letter
 * @param {any} attachment
 */
function docxBlock(letter, attachment) {
  const text = h('div', { class: 'letter-body docx-text', 'aria-live': 'polite' }, h('span', { class: 'text-body-secondary', text: 'Cargando el texto del documento…' }));
  const block = h(
    'section',
    { class: 'docx-document' },
    h(
      'div',
      { class: 'd-flex flex-wrap justify-content-between align-items-center gap-2 mb-2' },
      h('h4', { class: 'h6 mb-0', text: `Documento adjunto: ${attachment.filename}` }),
      h('div', { class: 'no-print' }, linkButton(attachmentUrl(letter.messageId, attachment.index, { download: true }), 'Descargar', { download: true })),
    ),
    text,
  );
  api
    .attachmentText(letter.messageId, attachment.index)
    .then((result) => {
      text.replaceChildren(result.text ? document.createTextNode(result.text) : h('span', { class: 'text-body-secondary', text: 'El documento no contiene texto.' }));
    })
    .catch((error) => {
      text.replaceChildren(h('span', { class: 'text-danger', text: error instanceof Error ? error.message : 'No se ha podido leer el documento.' }));
    });
  return block;
}

/**
 * @param {any} letter
 * @param {any} attachment
 * @returns {Node}
 */
function attachmentBlock(letter, attachment) {
  const detail = `${attachment.filename} · ${formatBytes(attachment.size)}`;
  if (attachment.kind === 'blocked') return card('Adjunto bloqueado por seguridad', detail, [], 'danger');
  if (!state.info?.attachmentsAvailable) return card('Adjunto', `${detail} · no disponible sin conexión con el correo`);
  if (tooLarge(attachment)) {
    return card('Adjunto demasiado grande', `${detail} · el límite es ${state.info?.maxAttachmentMb ?? 15} MB`, [], 'warning');
  }
  if (attachment.kind === 'image') return imageFigure(letter, attachment, 'attachment-thumb');
  if (attachment.kind === 'pdf') return pdfCard(letter, attachment);
  if (attachment.kind === 'docx') return docxBlock(letter, attachment);
  return card('Adjunto no imprimible', detail, [
    linkButton(attachmentUrl(letter.messageId, attachment.index, { download: true }), 'Descargar', { download: true }),
  ]);
}

/**
 * Letter body: text (pre-wrap) with `[cid:…]` markers replaced by the inline images.
 * @param {any} letter
 * @returns {{ body: HTMLElement, usedInline: Set<number> }}
 */
export function renderBody(letter) {
  const usedInline = new Set();
  const text = letter.body ?? '';
  if (!text.trim()) {
    return { body: h('p', { class: 'letter-body is-empty', text: 'La carta no tiene texto.' }), usedInline };
  }
  const nodes = [];
  let last = 0;
  const canShowImages = Boolean(state.info?.attachmentsAvailable);
  for (const match of text.matchAll(CID_MARKER)) {
    const attachment = letter.attachments.find(
      (/** @type {any} */ a) => a.inline && a.contentId && a.contentId.toLowerCase() === match[1].toLowerCase(),
    );
    if (!attachment || !canShowImages || tooLarge(attachment)) continue;
    nodes.push(text.slice(last, match.index));
    nodes.push(imageFigure(letter, attachment, 'letter-inline-image'));
    usedInline.add(attachment.index);
    last = /** @type {number} */ (match.index) + match[0].length;
  }
  nodes.push(text.slice(last));
  return { body: h('div', { class: 'letter-body' }, nodes), usedInline };
}

/**
 * @param {any} letter
 * @param {Set<number>} usedInline
 * @returns {HTMLElement | null}
 */
export function renderAttachments(letter, usedInline) {
  const remaining = letter.attachments.filter((/** @type {any} */ a) => !usedInline.has(a.index));
  if (remaining.length === 0) return null;
  return h(
    'div',
    { class: 'letter-attachments-list', role: 'group', 'aria-label': 'Adjuntos' },
    remaining.map((/** @type {any} */ attachment) => attachmentBlock(letter, attachment)),
  );
}
