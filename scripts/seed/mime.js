/**
 * Minimal RFC 5322 / MIME message builder for the Gmail test-letter seed.
 * Supports plain text (any charset), HTML, multipart/alternative, inline images
 * (multipart/related with Content-ID), attachments and extra headers.
 */
import { randomBytes } from 'node:crypto';

/**
 * RFC 2047 encoded-word for non-ASCII header values.
 * @param {string} value
 */
export function encodeHeader(value) {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/**
 * "Name <address>" with the display name encoded when needed.
 * @param {{ name?: string, address: string }} mailbox
 */
export function formatAddress({ name, address }) {
  if (!name) return address;
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/"/g, '')}" <${address}>` : `${encodeHeader(name)} <${address}>`;
}

/**
 * @param {Buffer} data
 */
function base64Lines(data) {
  return data.toString('base64').replace(/.{1,76}/g, '$&\r\n');
}

/**
 * @param {string} filename
 */
function filenameParam(filename) {
  return /^[\x20-\x7e]*$/.test(filename) ? `"${filename}"` : `"${encodeHeader(filename)}"`;
}

/**
 * @typedef {Object} MimeAttachment
 * @property {string} filename
 * @property {string} mimeType
 * @property {Buffer} data
 * @property {string} [contentId]  Inline image referenced as cid:<contentId>.
 */

/**
 * @typedef {Object} MimeMessage
 * @property {{ name?: string, address: string }} from
 * @property {{ name?: string, address: string }} to
 * @property {string} subject
 * @property {Date} date
 * @property {string} [text]
 * @property {string} [textCharset]   'utf-8' (default) or e.g. 'iso-8859-1'.
 * @property {string} [html]
 * @property {MimeAttachment[]} [attachments]
 * @property {Record<string, string>} [headers]
 * @property {string} [messageId]
 */

/**
 * @param {string} boundary
 * @param {string[]} parts  Already serialized parts (headers + body).
 */
function multipart(boundary, parts) {
  return `${parts.map((part) => `--${boundary}\r\n${part}`).join('\r\n')}\r\n--${boundary}--\r\n`;
}

/**
 * @param {string} content
 * @param {string} type
 * @param {string} charset
 */
function textPart(content, type, charset) {
  const data = charset.toLowerCase() === 'utf-8' ? Buffer.from(content, 'utf8') : Buffer.from(content, 'latin1');
  return `Content-Type: ${type}; charset="${charset}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${base64Lines(data)}`;
}

/**
 * @param {MimeAttachment} attachment
 */
function attachmentPart(attachment) {
  const headers = [`Content-Type: ${attachment.mimeType}; name=${filenameParam(attachment.filename)}`, 'Content-Transfer-Encoding: base64'];
  if (attachment.contentId) {
    headers.push(`Content-ID: <${attachment.contentId}>`, `Content-Disposition: inline; filename=${filenameParam(attachment.filename)}`);
  } else {
    headers.push(`Content-Disposition: attachment; filename=${filenameParam(attachment.filename)}`);
  }
  return `${headers.join('\r\n')}\r\n\r\n${base64Lines(attachment.data)}`;
}

/**
 * Serializes a message to raw RFC 5322 bytes.
 * @param {MimeMessage} message
 * @returns {Buffer}
 */
export function buildMime(message) {
  const boundary = () => `=_${randomBytes(12).toString('hex')}`;
  const charset = message.textCharset ?? 'utf-8';
  const attachments = message.attachments ?? [];
  const inline = attachments.filter((a) => a.contentId);
  const regular = attachments.filter((a) => !a.contentId);

  /** @type {string | null} */
  let body = null;
  if (message.text !== undefined && message.html !== undefined) {
    const b = boundary();
    body = `Content-Type: multipart/alternative; boundary="${b}"\r\n\r\n${multipart(b, [
      textPart(message.text, 'text/plain', charset),
      textPart(message.html, 'text/html', 'utf-8'),
    ])}`;
  } else if (message.html !== undefined) {
    body = textPart(message.html, 'text/html', 'utf-8');
  } else if (message.text !== undefined) {
    body = textPart(message.text, 'text/plain', charset);
  }

  if (inline.length > 0) {
    const b = boundary();
    body = `Content-Type: multipart/related; boundary="${b}"\r\n\r\n${multipart(b, [...(body ? [body] : []), ...inline.map(attachmentPart)])}`;
  }
  if (regular.length > 0) {
    const b = boundary();
    body = `Content-Type: multipart/mixed; boundary="${b}"\r\n\r\n${multipart(b, [...(body ? [body] : []), ...regular.map(attachmentPart)])}`;
  }
  if (!body) body = textPart('', 'text/plain', 'utf-8');

  const headers = [
    `From: ${formatAddress(message.from)}`,
    `To: ${formatAddress(message.to)}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${message.date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${message.messageId ?? `${randomBytes(10).toString('hex')}@familias-prueba.example`}>`,
    'MIME-Version: 1.0',
    ...Object.entries(message.headers ?? {}).map(([name, value]) => `${name}: ${encodeHeader(value)}`),
  ];
  return Buffer.from(`${headers.join('\r\n')}\r\n${body}`, 'utf8');
}
