/**
 * Letter card: sender, date, subject, assignment badge (with the matched text as tooltip),
 * flags, full body (pre-wrap, never truncated) and attachments.
 *
 * The content starts COLLAPSED (subject, sender, badges and a one-line preview) to keep the
 * page simple; the subject toggles it. The body and attachments are built on first opening
 * (images and PDF previews are not requested until then). Opened letters stay open when the
 * list is re-rendered, and every letter opens before printing the page (Ctrl+P).
 */
import { renderAttachments, renderBody } from './attachments.js';
import { enableTooltips, h } from './dom.js';
import { formatLongDateTime, senderName } from './format.js';
import { ASSIGNMENT_STATUS_LABELS, FLAG_LABELS, INFO_FLAGS, SIGNAL_LABELS } from './labels.js';

/**
 * @param {any} assignment
 */
function assignmentBadge(assignment) {
  if (assignment.status !== 'ASSIGNED') {
    const variant = assignment.status === 'NEEDS_REVIEW' ? 'text-bg-warning' : 'text-bg-secondary';
    return h('span', { class: `badge ${variant}`, text: ASSIGNMENT_STATUS_LABELS[assignment.status] ?? assignment.status });
  }
  const label = SIGNAL_LABELS[assignment.signal] ?? 'Asignada';
  const tooltip = assignment.manual
    ? 'Asignada manualmente por el equipo'
    : assignment.matchedText
      ? `Coincidencia: «${assignment.matchedText}»`
      : 'Asignada automáticamente';
  const variant = assignment.manual ? 'text-bg-dark' : 'text-bg-primary';
  return h('span', {
    class: `badge ${variant} badge-signal`,
    tabindex: '0',
    'data-bs-toggle': 'tooltip',
    'data-bs-title': tooltip,
    'aria-label': `${label}. ${tooltip}`,
    text: label,
  });
}

/**
 * @param {any} flag
 */
function flagBadge(flag) {
  const label = FLAG_LABELS[flag.type] ?? flag.type;
  const variant = INFO_FLAGS.has(flag.type) ? 'text-bg-light border' : 'text-bg-danger';
  return h('span', {
    class: `badge ${variant}`,
    tabindex: '0',
    'data-bs-toggle': 'tooltip',
    'data-bs-title': flag.reason || label,
    'aria-label': `${label}. ${flag.reason || ''}`,
    text: label,
  });
}

/** Letters opened by staff in this session (kept open across re-renders). */
const openLetters = new Set();
/** card element → open/close function */
const togglers = new WeakMap();
let sequence = 0;

const PREVIEW_CHARS = 160;

/**
 * One-line preview of the body (cid markers removed, whitespace collapsed).
 * @param {any} letter
 * @returns {string}
 */
function previewText(letter) {
  const text = String(letter.body ?? '')
    .replace(/\[cid:[^\]]*\]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return letter.attachments?.length ? 'Sin texto · con adjuntos' : 'La carta no tiene texto.';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
}

/**
 * Opens or closes every letter card inside `root`.
 * @param {ParentNode} root
 * @param {boolean} open
 */
export function setLettersOpen(root, open) {
  for (const card of root.querySelectorAll('.letter-card')) togglers.get(card)?.(open);
}

/**
 * "Abrir todas / Cerrar todas" buttons for a list of letter cards.
 * @param {() => ParentNode} getRoot
 * @returns {HTMLElement}
 */
export function letterToggleAllButtons(getRoot) {
  return h(
    'div',
    { class: 'btn-group btn-group-sm no-print', role: 'group', 'aria-label': 'Mostrar u ocultar el contenido de las cartas' },
    h('button', { type: 'button', class: 'btn btn-outline-secondary', text: 'Abrir todas', onClick: () => setLettersOpen(getRoot(), true) }),
    h('button', { type: 'button', class: 'btn btn-outline-secondary', text: 'Cerrar todas', onClick: () => setLettersOpen(getRoot(), false) }),
  );
}

// Printing the dashboard itself (Ctrl+P) shows every letter in full.
window.addEventListener('beforeprint', () => setLettersOpen(document, true));

/**
 * @param {any} letter
 * @param {{ actions?: Node[], showRecipients?: boolean }} [options]
 * @returns {HTMLElement}
 */
export function letterCard(letter, { actions = [], showRecipients = false } = {}) {
  const recipients =
    showRecipients && letter.assignment.participants.length > 0
      ? h('p', { class: 'letter-meta mb-0' }, 'Para: ', letter.assignment.participants.map((p) => p.displayName).join(', '))
      : null;

  sequence += 1;
  const contentId = `letter-content-${sequence}`;
  const content = h('div', { class: 'card-body letter-content', id: contentId, hidden: true });
  const preview = h('p', { class: 'letter-preview', text: previewText(letter) });
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'letter-toggle',
      'aria-expanded': 'false',
      'aria-controls': contentId,
      title: 'Mostrar u ocultar la carta',
    },
    h('span', { class: 'letter-toggle-icon', 'aria-hidden': 'true' }),
    h('span', { text: letter.subject || '(Sin asunto)' }),
  );

  let built = false;
  /** @param {boolean} open */
  const setOpen = (open) => {
    if (open && !built) {
      const { body, usedInline } = renderBody(letter);
      content.append(body, renderAttachments(letter, usedInline) ?? '');
      enableTooltips(content);
      built = true;
    }
    content.hidden = !open;
    preview.hidden = open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    card.classList.toggle('is-open', open);
    if (open) openLetters.add(letter.messageId);
    else openLetters.delete(letter.messageId);
  };
  toggle.addEventListener('click', () => setOpen(content.hidden));

  const card = h(
    'article',
    { class: `card letter-card mb-3${letter.isNew ? ' is-new' : ''}`, dataset: { messageId: letter.messageId } },
    h(
      'header',
      { class: 'card-header' },
      h(
        'div',
        { class: 'd-flex flex-wrap justify-content-between gap-2' },
        h(
          'div',
          {},
          h('h3', { class: 'letter-subject' }, toggle),
          h(
            'p',
            { class: 'letter-meta' },
            `De: ${senderName(letter.from)} · `,
            h('time', { datetime: letter.receivedAt, text: formatLongDateTime(letter.receivedAt) }),
          ),
          recipients,
          preview,
        ),
        h(
          'div',
          { class: 'd-flex flex-wrap gap-1 align-items-start' },
          letter.isNew ? h('span', { class: 'badge text-bg-info badge-new', text: 'Nueva' }) : null,
          assignmentBadge(letter.assignment),
          letter.flags.map(flagBadge),
        ),
      ),
    ),
    content,
    actions.length > 0 ? h('footer', { class: 'card-footer bg-body letter-actions d-flex flex-wrap gap-2' }, actions) : null,
  );
  togglers.set(card, setOpen);
  if (openLetters.has(letter.messageId)) setOpen(true);
  return card;
}
