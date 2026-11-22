/**
 * Letter row: a compact, inbox-like line (sender, subject, one-line preview, a few quiet
 * tags and a short date) that opens in place to show the full body (pre-wrap, never
 * truncated) and attachments.
 *
 * Rows start COLLAPSED to keep the page calm; the row toggles them. The body and
 * attachments are built on first opening (images and PDF previews are not requested until
 * then). Opened letters stay open when the list is re-rendered, and every letter opens
 * before printing the page (Ctrl+P). Rows are meant to live inside a `.letter-list`.
 */
import { renderAttachments, renderBody } from './attachments.js';
import { api } from './api.js';
import { enableTooltips, h, withBusy } from './dom.js';
import { emit } from './state.js';
import { toastError } from './ui.js';
import { formatLongDateTime, formatShortDateTime, senderName } from './format.js';
import { ASSIGNMENT_STATUS_LABELS, FLAG_LABELS, INFO_FLAGS } from './labels.js';

/** How an automatic assignment was made (shown inside the open letter). */
const HOW_ASSIGNED = Object.freeze({
  SUBJECT_EXPLICIT: 'Asignada por el asunto',
  BODY_EXPLICIT: 'Asignada por el saludo de la carta',
  NAME_MENTION: 'Asignada por una mención del nombre',
  NAME_SIMILAR: 'Asignada por un nombre parecido',
});

/** Shorter tag texts for the row (the full label stays in the tooltip). */
const SHORT_FLAG_LABELS = Object.freeze({ HAS_ATTACHMENTS: 'Adjuntos', MULTI_RECIPIENT: 'Varios' });

/**
 * Quiet tag with a tooltip.
 * @param {string} text
 * @param {string} tooltip
 * @param {'' | 'is-warning' | 'is-danger' | 'is-dark'} [tone]
 */
function tag(text, tooltip, tone = '') {
  return h('span', {
    class: `letter-tag ${tone}`.trim(),
    tabindex: '0',
    'data-bs-toggle': 'tooltip',
    'data-bs-title': tooltip,
    'aria-label': tooltip === text ? text : `${text}. ${tooltip}`,
    text,
  });
}

/**
 * Status tag: only when it adds information (manual assignments and letters that are not
 * assigned). How an automatic assignment was made is explained inside the open letter.
 * @param {any} assignment
 * @param {boolean} showStatus
 */
function assignmentTag(assignment, showStatus) {
  if (assignment.status === 'ASSIGNED') return assignment.manual ? tag('Manual', 'Asignada manualmente por el equipo', 'is-dark') : null;
  if (!showStatus) return null;
  const label = ASSIGNMENT_STATUS_LABELS[assignment.status] ?? assignment.status;
  return tag(label, label, assignment.status === 'NEEDS_REVIEW' ? 'is-warning' : '');
}

/**
 * "Asignada por el asunto: «Carta para Juan»" (shown inside the open letter).
 * @param {any} assignment
 * @returns {string | null}
 */
function assignmentExplanation(assignment) {
  if (assignment.status !== 'ASSIGNED') return null;
  if (assignment.manual) return 'Asignada manualmente por el equipo';
  const how = HOW_ASSIGNED[/** @type {keyof typeof HOW_ASSIGNED} */ (assignment.signal)] ?? 'Asignada automáticamente';
  return assignment.matchedText ? `${how}: «${assignment.matchedText}»` : how;
}

/**
 * @param {any} flag
 */
function flagTag(flag) {
  const label = FLAG_LABELS[flag.type] ?? flag.type;
  const short = SHORT_FLAG_LABELS[/** @type {keyof typeof SHORT_FLAG_LABELS} */ (flag.type)] ?? label;
  return tag(short, flag.reason || label, INFO_FLAGS.has(flag.type) ? '' : 'is-danger');
}

/**
 * Address part of a From header ('"Ana" <ana@x.com>' → 'ana@x.com'), or null.
 * @param {string} from
 */
function senderAddress(from) {
  return /<([^>]+)>\s*$/.exec(from ?? '')?.[1] ?? null;
}

/**
 * "✓ Impresa" / "Sin imprimir": shows whether the letter was printed and toggles it.
 * @param {{ printed: boolean, highlight: boolean, onToggle: (button: HTMLButtonElement) => void }} print
 */
function printToggle({ printed, highlight, onToggle }) {
  const button = /** @type {HTMLButtonElement} */ (
    h('button', {
      type: 'button',
      class: `letter-print${printed ? ' is-printed' : highlight ? ' is-new' : ''}`,
      'aria-pressed': printed ? 'true' : 'false',
      title: printed ? 'Impresa. Pulsa para marcarla como no impresa' : 'Sin imprimir. Pulsa para marcarla como impresa',
      text: printed ? '✓ Impresa' : 'Sin imprimir',
    })
  );
  button.addEventListener('click', () => onToggle(button));
  return button;
}

/**
 * Like Gmail: a closed envelope means unread (it becomes read when the letter is opened);
 * an open envelope means read, and clicking it marks the letter as unread again.
 * @param {any} letter
 * @param {boolean} unread
 * @returns {HTMLElement}
 */
function readIndicator(letter, unread) {
  if (unread) {
    return h(
      'span',
      { class: 'letter-seen is-unseen', role: 'img', 'aria-label': 'Sin leer', title: 'Sin leer: se marca como leída al abrirla' },
      h('span', { class: 'envelope is-closed' }),
    );
  }
  const button = /** @type {HTMLButtonElement} */ (
    h(
      'button',
      { type: 'button', class: 'letter-seen', 'aria-label': 'Leída. Marcar como no leída', title: 'Leída. Pulsa para marcarla como no leída' },
      h('span', { class: 'envelope is-open' }),
    )
  );
  button.addEventListener('click', () =>
    void withBusy(button, async () => {
      try {
        await api.markUnseen([letter.messageId]);
        // Like Gmail: marking as unread closes the letter.
        openLetters.delete(letter.messageId);
        emit('data-changed');
      } catch (error) {
        toastError(error);
      }
    }),
  );
  return button;
}

/** Letters opened by staff in this session (kept open across re-renders). */
const openLetters = new Set();
/** card element → open/close function */
const togglers = new WeakMap();
let sequence = 0;

const PREVIEW_CHARS = 220;

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
  if (!text) return letter.attachments?.length ? 'Sin texto · con adjuntos' : 'Sin texto';
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;
}

/**
 * Opens or closes every letter inside `root`.
 * @param {ParentNode} root
 * @param {boolean} open
 */
export function setLettersOpen(root, open) {
  for (const card of root.querySelectorAll('.letter-card')) togglers.get(card)?.(open);
}

/**
 * One "Abrir todas" / "Cerrar todas" button for a list of letters: opens them all while
 * any is closed, otherwise closes them.
 * @param {() => ParentNode} getRoot
 * @returns {HTMLElement}
 */
export function letterToggleAllButtons(getRoot) {
  const button = /** @type {HTMLButtonElement} */ (
    h('button', { type: 'button', class: 'btn btn-sm btn-link text-decoration-none px-0 no-print', text: 'Abrir todas' })
  );
  button.addEventListener('click', () => {
    const root = getRoot();
    const anyClosed = [...root.querySelectorAll('.letter-card')].some((card) => !card.classList.contains('is-open'));
    setLettersOpen(root, anyClosed);
    button.textContent = anyClosed ? 'Cerrar todas' : 'Abrir todas';
  });
  return button;
}

// Printing the dashboard itself (Ctrl+P) shows every letter in full.
window.addEventListener('beforeprint', () => setLettersOpen(document, true));

/**
 * @param {any} letter
 * @param {{ actions?: Node[], actionsWhenOpen?: boolean, showRecipients?: boolean, showStatus?: boolean, print?: { printed: boolean, highlight: boolean, onToggle: (button: HTMLButtonElement) => void } | null }} [options]
 *   actions          Buttons for the letter.
 *   actionsWhenOpen  Show the actions only inside the open letter (quiet lists).
 *   showRecipients   Add a "Para: …" line.
 *   showStatus       Tag letters that are not assigned (off where every letter shares the status).
 *   print            Printed / not printed toggle for the participant being viewed (highlight:
 *                    show unprinted letters as new, when other letters were printed before).
 * @returns {HTMLElement}
 */
export function letterCard(letter, { actions = [], actionsWhenOpen = false, showRecipients = false, showStatus = true, print = null } = {}) {
  const sender = senderName(letter.from);
  const subject = letter.subject || '(Sin asunto)';
  const recipients =
    showRecipients && letter.assignment.participants.length > 0
      ? h('p', { class: 'letter-sub' }, 'Para ', h('strong', { text: letter.assignment.participants.map((/** @type {any} */ p) => p.displayName).join(', ') }))
      : null;

  sequence += 1;
  const contentId = `letter-content-${sequence}`;
  const explanation = assignmentExplanation(letter.assignment);
  const actionBar = actions.length > 0 ? h('div', { class: 'letter-actions' }, actions) : null;
  const content = h(
    'div',
    { class: 'letter-content', id: contentId, hidden: true },
    h(
      'p',
      { class: 'letter-meta' },
      h('span', { text: `De ${sender}` }),
      senderAddress(letter.from) ? h('span', { class: 'text-body-tertiary', text: ` <${senderAddress(letter.from)}>` }) : null,
      h('span', { 'aria-hidden': 'true', text: ' · ' }),
      h('time', { datetime: letter.receivedAt, text: formatLongDateTime(letter.receivedAt) }),
      explanation ? h('span', { class: 'd-block', text: explanation }) : null,
    ),
  );
  const preview = h('span', { class: 'letter-preview', text: previewText(letter) });
  const toggle = h(
    'button',
    {
      type: 'button',
      class: 'letter-toggle',
      'aria-expanded': 'false',
      'aria-controls': contentId,
      'aria-label': `${subject}. De ${sender}${letter.isNew ? '. Nueva' : ''}`,
    },
    h('span', { class: 'letter-toggle-icon', 'aria-hidden': 'true' }),
    h('span', { class: 'letter-from', text: sender }),
    h('span', { class: 'letter-line' }, h('span', { class: 'letter-subject', text: subject }), preview),
  );

  let built = false;
  /** @param {boolean} open */
  const setOpen = (open) => {
    if (open && !built) {
      const { body, usedInline } = renderBody(letter);
      content.append(body, renderAttachments(letter, usedInline) ?? '');
      if (actionsWhenOpen && actionBar) content.append(actionBar);
      enableTooltips(content);
      built = true;
    }
    content.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    card.classList.toggle('is-open', open);
    if (open) openLetters.add(letter.messageId);
    else openLetters.delete(letter.messageId);
  };
  let indicator = readIndicator(letter, letter.isNew === true);
  // Opening an unread letter marks it as read (only when a person opens it: not "Abrir
  // todas", not printing, not restoring open letters after a refresh).
  const markRead = () => {
    if (letter.isNew !== true) return;
    letter.isNew = false;
    card.classList.remove('is-new');
    const read = readIndicator(letter, false);
    indicator.replaceWith(read);
    indicator = read;
    api
      .markSeen({ messageIds: [letter.messageId] })
      .then(() => emit('data-changed'))
      .catch(toastError);
  };
  toggle.addEventListener('click', () => {
    const opening = content.hidden;
    setOpen(opening);
    if (opening) markRead();
  });

  const withdrawn = letter.assignment.participants.some((/** @type {any} */ p) => p.withdrawn);
  const card = h(
    'article',
    { class: `letter-card${letter.isNew ? ' is-new' : ''}`, dataset: { messageId: letter.messageId } },
    // Printed copies show a plain heading instead of the interactive row.
    h('h3', { class: 'letter-print-heading', text: subject }),
    h(
      'div',
      { class: 'letter-row' },
      indicator,
      toggle,
      h(
        'div',
        { class: 'letter-side' },
        withdrawn ? tag('Baja', 'El destinatario ya no está en el retiro') : null,
        assignmentTag(letter.assignment, showStatus),
        letter.flags.map(flagTag),
        print ? printToggle(print) : null,
        h('time', { class: 'letter-date', datetime: letter.receivedAt, title: formatLongDateTime(letter.receivedAt), text: formatShortDateTime(letter.receivedAt) }),
      ),
    ),
    recipients,
    content,
    actionsWhenOpen ? null : actionBar,
  );
  togglers.set(card, setOpen);
  if (openLetters.has(letter.messageId)) setOpen(true);
  return card;
}
