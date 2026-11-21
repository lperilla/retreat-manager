/**
 * Heuristic flags. Flags NEVER discard a letter: flagged letters stay counted and the UI
 * only shows badges and a filter.
 */
import { DEFAULTS, FLAG_ORDER, FlagType } from '../constants.js';
import { createFlag } from '../entities/Letter.js';
import { cleanForAnalysis, meaningfulLength, normalizeText, stripSubjectPrefixes } from './text.js';

/**
 * @typedef {Object} HeuristicsInput
 * @property {string} [subject]
 * @property {string} [body]
 * @property {string} [from]
 * @property {Record<string, string | string[]> | Array<{ name: string, value: string }> | Map<string, string>} [headers]
 *           Raw message headers (only available at sync time; never persisted).
 * @property {ReadonlyArray<{ filename?: string, mimeType?: string }>} [attachments]
 * @property {readonly string[]} [participantIds]  Final assigned participants.
 */

const AUTO_REPLY_SUBJECT =
  /^(?:respuesta automatica|autorespuesta|automatic reply|auto[ -]?reply|autoreply|fuera de la oficina|out of office|estoy fuera|ausencia|ausente)\b/;
const MAILER_DAEMON_FROM = /\b(?:mailer-daemon|postmaster|mail delivery subsystem)\b/;
const MAILER_DAEMON_SUBJECT =
  /\b(?:delivery status notification|undeliverable|undelivered mail|mail delivery failed|returned mail|no se ha podido entregar|no se puede entregar|notificacion de estado de entrega|error de entrega)\b/;
const BULK_PRECEDENCE = /^(?:bulk|list|junk)$/;

/**
 * @param {HeuristicsInput['headers']} headers
 * @returns {Map<string, string>}
 */
export function normalizeHeaders(headers) {
  /** @type {Map<string, string>} */
  const out = new Map();
  if (!headers) return out;
  /** @type {Iterable<[string, unknown]>} */
  let entries;
  if (headers instanceof Map) entries = headers.entries();
  else if (Array.isArray(headers)) entries = headers.map((h) => /** @type {[string, unknown]} */ ([h?.name, h?.value]));
  else entries = Object.entries(headers);
  for (const [name, value] of entries) {
    if (typeof name !== 'string' || !name) continue;
    const text = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    out.set(name.trim().toLowerCase(), text.trim());
  }
  return out;
}

/**
 * @param {Map<string, { type: string, confidence: number, reason: string }>} found
 * @param {string} type
 * @param {number} confidence
 * @param {string} reason
 */
function raise(found, type, confidence, reason) {
  const current = found.get(type);
  if (!current || confidence > current.confidence) found.set(type, { type, confidence, reason });
}

/**
 * @param {number} count
 * @returns {string}
 */
function attachmentsLabel(count) {
  return count === 1 ? '1 adjunto' : `${count} adjuntos`;
}

/**
 * Computes all heuristic flags for a letter.
 * @param {HeuristicsInput} input
 * @param {{ signatureOnlyMaxChars?: number }} [options]
 * @returns {ReadonlyArray<Readonly<import('../entities/Letter.js').LetterFlag>>}
 */
export function computeFlags(input, { signatureOnlyMaxChars = DEFAULTS.SIGNATURE_ONLY_MAX_CHARS } = {}) {
  const { subject = '', body = '', from = '', headers, attachments = [], participantIds = [] } = input ?? {};
  const headerMap = normalizeHeaders(headers);
  const subjectNorm = normalizeText(stripSubjectPrefixes(subject));
  const fromNorm = normalizeText(from);
  /** @type {Map<string, { type: string, confidence: number, reason: string }>} */
  const found = new Map();

  // AUTO_REPLY
  const autoSubmitted = (headerMap.get('auto-submitted') ?? '').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') {
    raise(found, FlagType.AUTO_REPLY, 0.95, `Cabecera Auto-Submitted: ${autoSubmitted}`);
  }
  if (headerMap.has('x-autoreply') || headerMap.has('x-autorespond')) {
    raise(found, FlagType.AUTO_REPLY, 0.9, 'Cabecera de respuesta automática presente');
  }
  if (AUTO_REPLY_SUBJECT.test(subjectNorm)) {
    raise(found, FlagType.AUTO_REPLY, 0.8, 'El asunto indica una respuesta automática');
  }

  // NEWSLETTER_OR_BULK
  if (headerMap.has('list-unsubscribe')) {
    raise(found, FlagType.NEWSLETTER_OR_BULK, 0.9, 'Cabecera List-Unsubscribe presente (envío masivo)');
  }
  const precedence = (headerMap.get('precedence') ?? '').toLowerCase();
  if (BULK_PRECEDENCE.test(precedence)) {
    raise(found, FlagType.NEWSLETTER_OR_BULK, 0.85, `Cabecera Precedence: ${precedence}`);
  }
  if (headerMap.has('list-id')) {
    raise(found, FlagType.NEWSLETTER_OR_BULK, 0.7, 'Cabecera List-Id presente (lista de correo)');
  }

  // MAILER_DAEMON
  if (MAILER_DAEMON_FROM.test(fromNorm)) {
    raise(found, FlagType.MAILER_DAEMON, 0.95, 'Remitente de sistema (mailer-daemon/postmaster)');
  }
  if (MAILER_DAEMON_SUBJECT.test(subjectNorm)) {
    raise(found, FlagType.MAILER_DAEMON, 0.8, 'El asunto indica un error de entrega');
  }

  // ATTACHMENT_ONLY vs SIGNATURE_ONLY
  const attachmentCount = attachments.length;
  const cleanedLength = meaningfulLength(cleanForAnalysis({ body, from }));
  const rawLength = meaningfulLength(body);
  if (attachmentCount > 0 && cleanedLength === 0) {
    raise(
      found,
      FlagType.ATTACHMENT_ONLY,
      0.95,
      rawLength === 0
        ? 'Solo contiene adjuntos, sin texto'
        : 'Solo contiene adjuntos (el texto es una firma o una cita)',
    );
  } else if (attachmentCount === 0 && cleanedLength < signatureOnlyMaxChars) {
    raise(
      found,
      FlagType.SIGNATURE_ONLY,
      cleanedLength === 0 ? 0.9 : 0.6,
      rawLength === 0 ? 'Cuerpo vacío' : 'Texto muy breve tras quitar firmas y citas',
    );
  }

  // MULTI_RECIPIENT
  const recipients = new Set(participantIds).size;
  if (recipients >= 2) {
    raise(found, FlagType.MULTI_RECIPIENT, 1, `Asignada a ${recipients} participantes`);
  }

  // HAS_ATTACHMENTS
  if (attachmentCount > 0) {
    raise(found, FlagType.HAS_ATTACHMENTS, 1, `Incluye ${attachmentsLabel(attachmentCount)}`);
  }

  return Object.freeze(
    FLAG_ORDER.filter((type) => found.has(type)).map((type) => createFlag(/** @type {any} */ (found.get(type)))),
  );
}

/**
 * Updates the MULTI_RECIPIENT flag after a manual override or a recomputation, keeping all
 * other flags (header-based flags cannot be recomputed without the original message).
 * @param {ReadonlyArray<import('../entities/Letter.js').LetterFlag>} flags
 * @param {readonly string[]} participantIds
 * @returns {ReadonlyArray<Readonly<import('../entities/Letter.js').LetterFlag>>}
 */
export function withMultiRecipientFlag(flags, participantIds) {
  const others = flags.filter((flag) => flag.type !== FlagType.MULTI_RECIPIENT);
  const recipients = new Set(participantIds).size;
  const next =
    recipients >= 2
      ? [...others, { type: FlagType.MULTI_RECIPIENT, confidence: 1, reason: `Asignada a ${recipients} participantes` }]
      : others;
  return Object.freeze(
    [...next]
      .sort((a, b) => FLAG_ORDER.indexOf(a.type) - FLAG_ORDER.indexOf(b.type))
      .map((flag) => createFlag(flag)),
  );
}
