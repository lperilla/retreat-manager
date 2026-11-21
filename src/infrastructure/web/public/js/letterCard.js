/**
 * Letter card: sender, date, subject, assignment badge (with the matched text as tooltip),
 * flags, full body (pre-wrap, never truncated) and attachments.
 */
import { h } from './dom.js';
import { formatBytes, formatLongDateTime, senderName } from './format.js';
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

  const body = letter.body?.trim()
    ? h('div', { class: 'letter-body', text: letter.body })
    : h('p', { class: 'letter-body is-empty', text: 'La carta no tiene texto.' });

  const attachments =
    letter.attachments.length > 0
      ? h(
          'ul',
          { class: 'letter-attachments', 'aria-label': 'Adjuntos' },
          letter.attachments.map((a) => h('li', {}, `Adjunto: ${a.filename} (${formatBytes(a.size)})`)),
        )
      : null;

  return h(
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
          h('h3', { class: 'letter-subject', text: letter.subject || '(Sin asunto)' }),
          h(
            'p',
            { class: 'letter-meta' },
            `De: ${senderName(letter.from)} · `,
            h('time', { datetime: letter.receivedAt, text: formatLongDateTime(letter.receivedAt) }),
          ),
          recipients,
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
    h('div', { class: 'card-body' }, body, attachments),
    actions.length > 0 ? h('footer', { class: 'card-footer bg-body letter-actions d-flex flex-wrap gap-2' }, actions) : null,
  );
}
