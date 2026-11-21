/**
 * Text normalization and cleaning helpers used by assignment and heuristics.
 * Pure functions only.
 *
 * Two representations coexist:
 * - the ORIGINAL text, kept verbatim for display and for `matchedText`;
 * - the NORMALIZED text (lowercase, no accents, collapsed whitespace) used for matching.
 * `normalizeWithMap` keeps an index map so matches can be sliced back from the original.
 */

const COMBINING_MARKS = /\p{M}+/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;
const WHITESPACE = /\s/u;
const INVISIBLE = /[​-‍⁠﻿]/u;

/**
 * Lowercases and strips diacritics from a single character ("Á" → "a", "ñ" → "n").
 * @param {string} ch
 * @returns {string}
 */
export function foldChar(ch) {
  return ch.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * @param {string | undefined} ch
 * @returns {boolean}
 */
export function isWordChar(ch) {
  return typeof ch === 'string' && ch.length > 0 && WORD_CHAR.test(ch);
}

/**
 * Normalizes text and returns, for every UTF-16 unit of the output, the index of the
 * originating unit in the input.
 * @param {string} input
 * @param {{ keepNewlines?: boolean }} [options] keepNewlines: preserve line structure (default true).
 * @returns {{ text: string, map: number[] }}
 */
export function normalizeWithMap(input, { keepNewlines = true } = {}) {
  const source = typeof input === 'string' ? input : '';
  let out = '';
  /** @type {number[]} */
  const map = [];
  let pendingSpace = -1;
  let lineHasContent = false;

  let i = 0;
  while (i < source.length) {
    const ch = String.fromCodePoint(/** @type {number} */ (source.codePointAt(i)));
    const width = ch.length;

    if (keepNewlines && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && source[i + 1] === '\n') {
        i += 1;
        continue;
      }
      out += '\n';
      map.push(i);
      pendingSpace = -1;
      lineHasContent = false;
      i += width;
      continue;
    }

    if (WHITESPACE.test(ch)) {
      if (lineHasContent && pendingSpace < 0) pendingSpace = i;
      i += width;
      continue;
    }

    if (INVISIBLE.test(ch)) {
      i += width;
      continue;
    }

    const folded = foldChar(ch);
    if (folded.length > 0) {
      if (pendingSpace >= 0) {
        out += ' ';
        map.push(pendingSpace);
        pendingSpace = -1;
      }
      out += folded;
      for (let k = 0; k < folded.length; k += 1) map.push(i);
      lineHasContent = true;
    }
    i += width;
  }

  return { text: out, map };
}

/**
 * @param {string} input
 * @param {{ keepNewlines?: boolean }} [options] keepNewlines defaults to false (single line).
 * @returns {string}
 */
export function normalizeText(input, { keepNewlines = false } = {}) {
  return normalizeWithMap(input, { keepNewlines }).text;
}

/**
 * Returns the original fragment that produced normalized[start, end).
 * @param {string} original
 * @param {number[]} map
 * @param {number} start
 * @param {number} end  Exclusive.
 * @returns {string}
 */
export function sliceOriginal(original, map, start, end) {
  if (end <= start || start >= map.length) return '';
  const from = map[start];
  const lastIndex = map[Math.min(end, map.length) - 1];
  const lastCodePoint = /** @type {number} */ (original.codePointAt(lastIndex));
  const to = lastIndex + (lastCodePoint > 0xffff ? 2 : 1);
  return original.slice(from, to).trim();
}

/**
 * Number of letters and digits (emojis, punctuation and whitespace excluded).
 * @param {string} input
 * @returns {number}
 */
export function meaningfulLength(input) {
  return (String(input ?? '').match(/[\p{L}\p{N}]/gu) ?? []).length;
}

/**
 * @param {string} input
 * @returns {number}
 */
function wordCount(input) {
  const trimmed = String(input).trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

/**
 * @param {string} input
 * @returns {string[]}
 */
export function toLines(input) {
  return String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
}

/**
 * @param {string[]} lines
 * @returns {string[]}
 */
function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

/**
 * @param {string[]} lines
 * @returns {number[]}
 */
function nonBlankIndexes(lines) {
  const indexes = [];
  for (let i = 0; i < lines.length; i += 1) if (lines[i].trim() !== '') indexes.push(i);
  return indexes;
}

const SUBJECT_PREFIX = /^\s*(?:re|rv|fw|fwd|reenv|reenviado|resp)\s*(?:\[\d+\])?\s*:\s*/i;

/**
 * Removes reply/forward prefixes ("RE:", "Fwd:", "RV:") from a subject.
 * @param {string} subject
 * @returns {string}
 */
export function stripSubjectPrefixes(subject) {
  let current = String(subject ?? '');
  let previous;
  do {
    previous = current;
    current = current.replace(SUBJECT_PREFIX, '');
  } while (current !== previous);
  return current.trim();
}

/**
 * Extracts a human name from a From header ('"Ana Pérez" <ana@x.com>' → 'Ana Pérez').
 * Falls back to the e-mail local part ("ana.perez@x.com" → "ana perez").
 * @param {string} from
 * @returns {string}
 */
export function parseSenderName(from) {
  const value = String(from ?? '').trim();
  if (!value) return '';
  const named = value.match(/^"?([^"<]*?)"?\s*<[^>]*>\s*$/);
  if (named && named[1].trim()) return named[1].trim();
  const email = value.match(/<?([^\s<>@"]+)@[^\s<>]+>?/);
  if (email) return email[1].replace(/[._+-]+/g, ' ').trim();
  return value;
}

// ---------------------------------------------------------------------------
// Quoted text
// ---------------------------------------------------------------------------

const REPLY_ATTRIBUTION = /^(?:el|on)\s.{0,300}\b(?:escribio|wrote)\s*:\s*$/;
const REPLY_ATTRIBUTION_HEAD = /^(?:el|on)\s/;
const REPLY_ATTRIBUTION_TAIL = /^.{0,160}\b(?:escribio|wrote)\s*:\s*$/;
const ORIGINAL_MESSAGE_MARKER = /^-{2,}\s*(?:mensaje original|original message)\s*-{2,}$/;
const FORWARD_MARKER =
  /^(?:-{2,}\s*(?:mensaje reenviado|forwarded message)\s*-{2,}|(?:inicio del mensaje reenviado|begin forwarded message)\s*:?)$/;
const SEPARATOR_LINE = /^[_-]{8,}$/;
const HEADER_LINE = /^(?:de|from|enviado|enviado el|sent|fecha|date|para|to|cc|cco|bcc|asunto|subject)\s*:/;
const HEADER_FROM = /^(?:de|from)\s*:/;
const HEADER_DATE = /^(?:enviado|enviado el|sent|fecha|date)\s*:/;
const HEADER_SUBJECT = /^(?:asunto|subject)\s*:/;

/**
 * Outlook-style quoted header block: "De: … / Enviado: … / Para: … / Asunto: …".
 * Requires a From line plus a date line, and either an e-mail address or a subject line,
 * so that a letter starting with "De: Mamá / Para: Juan" is not mistaken for a quote.
 * @param {string[]} lines
 * @param {number} index
 * @returns {boolean}
 */
function isQuotedHeaderBlock(lines, index) {
  if (index >= lines.length || !HEADER_FROM.test(normalizeText(lines[index]))) return false;
  let hasDate = false;
  let hasSubject = false;
  for (let j = index + 1; j < Math.min(lines.length, index + 6); j += 1) {
    const normalized = normalizeText(lines[j]);
    if (HEADER_DATE.test(normalized)) hasDate = true;
    if (HEADER_SUBJECT.test(normalized)) hasSubject = true;
  }
  const hasEmail = /@|</.test(lines[index]);
  return hasDate && (hasEmail || hasSubject);
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {number}
 */
function nextNonBlank(lines, start) {
  let j = start;
  while (j < lines.length && lines[j].trim() === '') j += 1;
  return j;
}

/**
 * Skips the header lines of a forwarded message; returns the index of its first content line.
 * @param {string[]} lines
 * @param {number} start
 * @returns {number}
 */
function skipForwardHeaders(lines, start) {
  let j = nextNonBlank(lines, start);
  let sawHeader = false;
  while (j < lines.length && HEADER_LINE.test(normalizeText(lines[j]))) {
    j += 1;
    sawHeader = true;
  }
  return sawHeader ? nextNonBlank(lines, j) : j;
}

/**
 * Removes quoted replies: `>` lines, "El … escribió:" attributions (and everything after),
 * "Mensaje original" blocks and Outlook header blocks. Forwarded messages keep their
 * content (it usually IS the letter) but lose the forwarding header lines.
 * @param {string} input
 * @returns {string}
 */
export function stripQuotedText(input) {
  const lines = toLines(input);
  /** @type {string[]} */
  const kept = [];

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (/^\s*>/.test(raw)) continue;
    const normalized = normalizeText(raw);

    if (FORWARD_MARKER.test(normalized)) {
      i = skipForwardHeaders(lines, i + 1) - 1;
      continue;
    }
    if (ORIGINAL_MESSAGE_MARKER.test(normalized)) break;
    if (REPLY_ATTRIBUTION.test(normalized)) break;
    if (
      i + 1 < lines.length &&
      REPLY_ATTRIBUTION_HEAD.test(normalized) &&
      /[\d@]/.test(normalized) &&
      REPLY_ATTRIBUTION_TAIL.test(normalizeText(lines[i + 1]))
    ) {
      break;
    }
    if (SEPARATOR_LINE.test(normalized) && isQuotedHeaderBlock(lines, nextNonBlank(lines, i + 1))) break;
    if (isQuotedHeaderBlock(lines, i)) break;

    kept.push(raw);
  }

  return trimBlankEdges(kept).join('\n');
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

const SIGNATURE_DELIMITER = /^--[ \t]?$/;
const MOBILE_SIGNATURE =
  /^(?:enviado desde (?:mi|el|la|correo|outlook|yahoo|gmail)\b|sent from (?:my|mail|outlook|yahoo)\b|get outlook for\b|obtener outlook para\b|descargar outlook\b|enviado con\b|sent with\b)/;
const CLOSING_LINE = new RegExp(
  [
    '^(?:un |muchos |mil |muchisimos |un fuerte |un gran |un enorme )?(?:fuerte |gran |enorme )?' +
      '(?:abrazo|abrazos|abrazote|beso|besos|besito|besitos|besazo|besazos|saludo|saludos|carino|carinos)\\b',
    '^con (?:todo (?:mi|nuestro) |mucho )?(?:carino|amor)\\b',
    '^(?:os|te) (?:quiero|queremos|adoro|adoramos)\\b',
    '^(?:atentamente|cordialmente|un saludo|recibe un)\\b',
    '^(?:tu|tus|vuestra|vuestro|vuestros) (?:madre|padre|mama|papa|abuela|abuelo|abuelos|hermana|hermano|hermanos|tia|tio|tios|familia|padres|amiga|amigo|prima|primo|madrina|padrino)\\b',
  ].join('|'),
);

/**
 * Drops the short signature block after the last closing phrase ("Un beso,\nMamá")
 * and any name written after a comma on the closing line itself ("Un beso, Mamá").
 * @param {string[]} lines
 * @returns {string[]}
 */
function stripAfterClosing(lines) {
  const indexes = nonBlankIndexes(lines);
  if (indexes.length < 2) return lines;
  const tail = indexes.slice(-6);

  for (let k = tail.length - 1; k >= 0; k -= 1) {
    const index = tail[k];
    if (index === indexes[0]) break;
    if (!CLOSING_LINE.test(normalizeText(lines[index]))) continue;

    const after = indexes.filter((i) => i > index);
    if (after.length > 3 || after.some((i) => wordCount(lines[i]) > 6)) return lines;

    const closing = lines[index].match(/^(.*?[,;])\s*\S+(?:\s+\S+){0,3}\s*[.!]*\s*$/u);
    return [...lines.slice(0, index), closing ? closing[1] : lines[index]];
  }
  return lines;
}

/**
 * Removes trailing lines made only of the sender's name (the sender is a relative and
 * is never a recipient signal). The first non-blank line is never removed.
 * @param {string[]} lines
 * @param {string} senderName
 * @returns {string[]}
 */
function stripSenderLines(lines, senderName) {
  const sender = normalizeText(senderName)
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (sender.length < 2) return lines;
  const senderTokens = new Set(sender.split(' ').filter((token) => token.length >= 2));
  if (senderTokens.size === 0) return lines;

  const indexes = nonBlankIndexes(lines);
  const candidates = indexes.slice(-3).filter((i) => i !== indexes[0]);
  const drop = new Set();
  for (const index of candidates) {
    const normalized = normalizeText(lines[index])
      .replace(/[^\p{L}\p{N} ]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) continue;
    const tokens = normalized.split(' ');
    const onlySender = tokens.every((token) => senderTokens.has(token));
    const containsFullName = sender.includes(' ') && tokens.length <= 8 && ` ${normalized} `.includes(` ${sender} `);
    if (onlySender || containsFullName) drop.add(index);
  }
  return lines.filter((_, i) => !drop.has(i));
}

/**
 * Removes signatures: RFC 3676 delimiter ("-- "), mobile/client footers
 * ("Enviado desde mi iPhone"), the block after a closing phrase and sender-name lines.
 * @param {string} input
 * @param {{ senderName?: string }} [options]
 * @returns {string}
 */
export function stripSignature(input, { senderName = '' } = {}) {
  let lines = toLines(input);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (SIGNATURE_DELIMITER.test(lines[i])) {
      lines = lines.slice(0, i);
      break;
    }
  }

  lines = lines.filter((line) => {
    const normalized = normalizeText(line);
    return !(normalized.length <= 80 && MOBILE_SIGNATURE.test(normalized));
  });
  lines = trimBlankEdges(lines);
  lines = stripAfterClosing(lines);
  lines = stripSenderLines(lines, senderName);

  return trimBlankEdges(lines).join('\n');
}

/**
 * Text used for analysis: body without quoted replies and without signatures.
 * The stored `cleanBody` is never modified; this is only an analysis view.
 * @param {{ body?: string, from?: string }} input
 * @returns {string}
 */
export function cleanForAnalysis({ body = '', from = '' }) {
  return stripSignature(stripQuotedText(body), { senderName: parseSenderName(from) });
}
