/**
 * Recursive MIME traversal of Gmail `format: "full"` payloads.
 * - Body: prefer `text/plain`; otherwise convert `text/html` to clean text (sanitize-html
 *   with an EMPTY allowlist). The plain text drives assignment, search and TXT/JSON exports.
 * - Formatted body: the `text/html` parts sanitized with a strict allowlist that keeps the
 *   look of the letter (colours, fonts, sizes, emphasis, alignment, `cid:` images) for
 *   printing; null when the HTML adds no formatting (see infrastructure/html/letterHtml.js).
 * - Attachments: metadata only (content is fetched on demand later).
 */
import sanitizeHtml from 'sanitize-html';

import { toFormattedBody } from '../html/letterHtml.js';

/**
 * @typedef {Object} GmailPart
 * @property {string} [partId]
 * @property {string} [mimeType]
 * @property {string} [filename]
 * @property {Array<{ name: string, value: string }>} [headers]
 * @property {{ size?: number, data?: string, attachmentId?: string }} [body]
 * @property {GmailPart[]} [parts]
 */

/**
 * @typedef {Object} ExtractedContent
 * @property {string} body
 * @property {'text/plain' | 'text/html' | 'none'} bodySource
 * @property {string | null} formattedBody  Sanitized HTML that keeps the letter's formatting.
 * @property {Array<{ filename: string, mimeType: string, size: number, contentId: string | null, attachmentId: string | null }>} attachments
 */

/**
 * @param {GmailPart} part
 * @param {string} name
 * @returns {string}
 */
function header(part, name) {
  const lower = name.toLowerCase();
  return part.headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? '';
}

/**
 * Decodes Gmail base64url data with the part's charset (UTF-8 by default).
 * @param {string | undefined} data
 * @param {string} contentType
 * @returns {string}
 */
export function decodeBody(data, contentType = '') {
  if (!data) return '';
  const bytes = Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const charset = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
}

const NAMED_ENTITIES = /** @type {Record<string, string>} */ ({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  iexcl: '¡',
  iquest: '¿',
  laquo: '«',
  raquo: '»',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  euro: '€',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  uuml: 'ü',
  Uuml: 'Ü',
  ccedil: 'ç',
  Ccedil: 'Ç',
});

/**
 * @param {string} text
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

/**
 * Converts an HTML e-mail into readable plain text: block elements become line breaks,
 * list items become "• ", every tag and attribute is dropped, entities are decoded and
 * paragraph breaks are preserved.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  const structured = String(html ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|tr|table|blockquote|ul|ol|section|article|header|footer)\s*>/gi, '\n')
    .replace(/<(p|div|h[1-6]|tr|table|blockquote|ul|ol|section|article|header|footer)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, '\t')
    .replace(/<hr\b[^>]*>/gi, '\n');

  const stripped = sanitizeHtml(structured, {
    allowedTags: [],
    allowedAttributes: {},
    allowedSchemes: [],
    disallowedTagsMode: 'discard',
    nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'head', 'title', 'template', 'svg'],
  });

  return decodeEntities(stripped)
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {GmailPart} part
 * @returns {boolean}
 */
function isAttachment(part) {
  const disposition = header(part, 'Content-Disposition').toLowerCase();
  return Boolean(part.filename) || disposition.startsWith('attachment') || Boolean(part.body?.attachmentId && !part.mimeType?.startsWith('text/'));
}

/**
 * Walks the MIME tree and returns the best body and the attachment metadata.
 * @param {GmailPart | undefined | null} payload
 * @returns {ExtractedContent}
 */
export function extractMessageContent(payload) {
  /** @type {string[]} */
  const plain = [];
  /** @type {string[]} */
  const html = [];
  /** @type {ExtractedContent['attachments']} */
  const attachments = [];

  /**
   * @param {GmailPart} part
   */
  const visit = (part) => {
    const mimeType = (part.mimeType ?? '').toLowerCase();
    if (mimeType.startsWith('multipart/')) {
      for (const child of part.parts ?? []) visit(child);
      return;
    }
    if (isAttachment(part)) {
      const contentId = header(part, 'Content-ID').replace(/^<|>$/g, '').trim();
      attachments.push({
        filename: part.filename || (contentId ? `imagen-${contentId}` : 'adjunto'),
        mimeType: mimeType || 'application/octet-stream',
        size: Number(part.body?.size ?? 0),
        contentId: contentId || null,
        attachmentId: part.body?.attachmentId ?? null,
      });
      return;
    }
    const contentType = header(part, 'Content-Type') || mimeType;
    if (mimeType === 'text/plain') plain.push(decodeBody(part.body?.data, contentType));
    else if (mimeType === 'text/html') html.push(decodeBody(part.body?.data, contentType));
    else if (mimeType === 'message/rfc822') for (const child of part.parts ?? []) visit(child);
  };

  if (payload) visit(payload);

  const formattedBody = html.length > 0 ? toFormattedBody(html) : null;
  const plainText = plain.join('\n\n').replace(/\r\n?/g, '\n').trim();
  if (plainText) return { body: plainText, bodySource: 'text/plain', formattedBody, attachments };
  const htmlText = html.map(htmlToText).filter(Boolean).join('\n\n');
  if (htmlText) return { body: htmlText, bodySource: 'text/html', formattedBody, attachments };
  return { body: '', bodySource: 'none', formattedBody, attachments };
}

/**
 * Header map (lower-case names) for heuristics.
 * @param {GmailPart | undefined | null} payload
 * @returns {Record<string, string>}
 */
export function headerMap(payload) {
  /** @type {Record<string, string>} */
  const map = {};
  for (const { name, value } of payload?.headers ?? []) {
    if (!name) continue;
    const key = name.toLowerCase();
    map[key] = map[key] ? `${map[key]}, ${value ?? ''}` : value ?? '';
  }
  return map;
}
