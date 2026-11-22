/**
 * "Pedir datos al remitente": when a letter cannot be matched to anyone, open a cordial
 * reply to the sender, already written, asking who the letter is for.
 *
 * The app only READS the mailbox (gmail.readonly), so it never sends anything itself: the
 * draft opens in Gmail (or the default mail program) and a person reviews it and presses
 * "Enviar". The draft names the retreat but never other participants.
 */
import { DEFAULT_RETREAT_NAME, formatLongDateTime, formatRetreatDays, senderName } from './format.js';
import { h } from './dom.js';
import { state } from './state.js';

/** Letters that are not from a person (no point in asking). */
const NOT_A_PERSON = new Set(['MAILER_DAEMON', 'NEWSLETTER_OR_BULK', 'AUTO_REPLY']);

/**
 * Address part of a From header ('"Ana" <ana@x.com>' → 'ana@x.com').
 * @param {string} from
 * @returns {string | null}
 */
function senderAddress(from) {
  const address = /<([^>]+)>\s*$/.exec(from ?? '')?.[1] ?? (/^[^\s@<>]+@[^\s@<>]+$/.test(String(from ?? '').trim()) ? String(from).trim() : null);
  return address && !/^(no-?reply|mailer-daemon|postmaster)@/i.test(address) ? address : null;
}

/**
 * Whether it makes sense to ask the sender of this letter.
 * @param {any} letter
 */
export function canAskSender(letter) {
  return senderAddress(letter.from) !== null && !letter.flags.some((/** @type {any} */ f) => NOT_A_PERSON.has(f.type));
}

/**
 * Subject and body of the request.
 * @param {any} letter
 * @returns {{ to: string, subject: string, body: string }}
 */
export function senderRequestDraft(letter) {
  const retreat = state.retreat;
  const named = retreat?.name && retreat.name !== DEFAULT_RETREAT_NAME;
  const days = named ? formatRetreatDays(retreat.startDate, retreat.endDate) : null;
  const retreatLabel = named ? `«${retreat.name}»${days ? ` (${days})` : ''}` : '';
  const name = senderName(letter.from);
  const greetingName = name.includes('@') ? '' : `, ${name}`;
  const subject = letter.subject ? `Re: ${letter.subject}` : `Tu carta para el retiro${named ? ` ${retreat.name}` : ''}`;
  const body = [
    `Hola${greetingName}:`,
    '',
    `Muchas gracias por escribir una carta para el retiro${retreatLabel ? ` ${retreatLabel}` : ''}. Nos ha llegado tu mensaje${letter.subject ? ` con el asunto «${letter.subject}»` : ''} del ${formatLongDateTime(letter.receivedAt)}.`,
    '',
    'Queremos que llegue a la persona correcta, pero no hemos podido saber con seguridad a quién va dirigida. ¿Podrías indicarnos:',
    '',
    '  - el nombre y los dos apellidos de la persona que está en el retiro, y',
    '  - si la conocemos por algún apodo, cuál es?',
    '',
    'Basta con que respondas a este correo con esos datos. Para próximas cartas, ayuda mucho poner en el asunto «Carta para Nombre Apellido».',
    '',
    'Un abrazo y gracias por acompañarle con tus palabras,',
    '',
    `El equipo del retiro${named ? ` ${retreat.name}` : ''}`,
  ].join('\n');
  return { to: /** @type {string} */ (senderAddress(letter.from)), subject, body };
}

/**
 * Gmail compose window with the draft (the mailbox is a Gmail account).
 * @param {{ to: string, subject: string, body: string }} draft
 */
function gmailComposeUrl({ to, subject, body }) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, su: subject, body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * Same draft in the default mail program.
 * @param {{ to: string, subject: string, body: string }} draft
 */
function mailtoUrl({ to, subject, body }) {
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * "Pedir datos al remitente" button (opens the draft in Gmail) plus a quiet link for the
 * default mail program. Null when the letter is not from a person.
 * @param {any} letter
 * @returns {HTMLElement | null}
 */
export function askSenderButton(letter) {
  if (!canAskSender(letter)) return null;
  const draft = () => senderRequestDraft(letter);
  return h(
    'span',
    { class: 'd-inline-flex align-items-center gap-1' },
    h('button', {
      type: 'button',
      class: 'btn btn-sm btn-outline-secondary',
      text: 'Pedir datos al remitente',
      title: 'Abre en Gmail una respuesta ya escrita pidiendo a quién va la carta. Revísala y pulsa «Enviar» desde la cuenta del buzón de cartas.',
      onClick: () => window.open(gmailComposeUrl(draft()), '_blank', 'noopener'),
    }),
    h('a', {
      class: 'small text-body-secondary',
      href: '#',
      text: 'otro programa',
      title: 'Abrir el mismo borrador con el programa de correo de este ordenador',
      onClick: (/** @type {Event} */ event) => {
        event.preventDefault();
        window.location.href = mailtoUrl(draft());
      },
    }),
  );
}
