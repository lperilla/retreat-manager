import { describeError } from '../../application/services/errorDescription.js';
import { AttachmentKind, CID_MARKER, classifyAttachment } from '../../domain/services/attachments.js';
import { parseSenderName } from '../../domain/services/text.js';
import { escapeHtml, formatBytes, formatDateTime, lettersLabel } from './format.js';
import { PACKET_CSS } from './packetStyles.js';

/** Upper bound for images embedded as data: URIs in one exported file. */
const DEFAULT_MAX_EMBEDDED_BYTES = 40 * 1024 * 1024;

/**
 * @typedef {Object} HtmlRenderOptions
 * @property {boolean} [includeAttachments]  Embed images, DOCX text and notes for other files (default true).
 * @property {string}  [stylesheetHref]      Link a stylesheet instead of embedding it (served print view).
 * @property {string}  [scriptHref]          Optional external script (served print view: print button).
 * @property {boolean} [toolbar]             Show the on-screen toolbar with the print button.
 * @property {(messageId: string, index: number, variant: 'display' | 'thumbnail') => string} [attachmentUrl]
 *           Served print view: reference images by URL instead of embedding them.
 */

/**
 * ExportRendererPort adapter: printable HTML packet, one section per participant with a
 * page break between participants. Every dynamic value is HTML-escaped; letter bodies are
 * rendered as text with `white-space: pre-wrap` (paragraphs, accents, ñ and emojis kept).
 *
 * With attachments included, images (EXIF-rotated JPEG) are embedded, `[cid:…]` markers are
 * replaced by the inline image, DOCX text is printed as part of the letter, and PDFs or
 * unsupported files are listed as notes.
 * @implements {import('../../application/ports/ExportRendererPort.js').ExportRendererPort}
 */
export class HtmlPacketRenderer {
  format = 'html';

  extension = 'html';

  mimeType = 'text/html; charset=utf-8';

  #attachments;
  #maxEmbeddedBytes;

  /**
   * @param {{
   *   attachments?: import('../../application/ports/AttachmentProcessorPort.js').AttachmentProcessorPort | null,
   *   maxEmbeddedBytes?: number,
   * }} [options]
   */
  constructor({ attachments = null, maxEmbeddedBytes = DEFAULT_MAX_EMBEDDED_BYTES } = {}) {
    this.#attachments = attachments;
    this.#maxEmbeddedBytes = maxEmbeddedBytes;
  }

  /**
   * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportPayload} payload
   * @param {HtmlRenderOptions} [options]
   * @returns {Promise<string>}
   */
  async render(payload, options = {}) {
    const { timeZone } = payload;
    const title =
      payload.participantCount === 1
        ? `Cartas para ${payload.sections[0].participant.displayName}`
        : `Cartas del retiro · ${payload.participantCount} participantes`;

    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      '<meta name="robots" content="noindex, nofollow">',
      `<title>${escapeHtml(title)}</title>`,
      options.stylesheetHref
        ? `<link rel="stylesheet" href="${escapeHtml(options.stylesheetHref)}">`
        : `<style>${PACKET_CSS}</style>`,
      options.scriptHref ? `<script type="module" src="${escapeHtml(options.scriptHref)}"></script>` : '',
    ].filter(Boolean);

    const toolbar = options.toolbar
      ? [
          '<div class="packet-toolbar no-print" role="region" aria-label="Opciones de impresión">',
          `<span>${escapeHtml(title)} · ${escapeHtml(lettersLabel(payload.letterCount))}</span>`,
          '<button type="button" data-action="print">Imprimir</button>',
          '</div>',
        ].join('')
      : '';

    const context = {
      timeZone,
      includeAttachments: options.includeAttachments !== false && this.#attachments !== null,
      attachmentUrl: options.attachmentUrl ?? null,
      embeddedBytes: 0,
    };
    const sections = [];
    for (const section of payload.sections) sections.push(await this.#renderSection(section, context));

    return [
      '<!doctype html>',
      '<html lang="es">',
      `<head>${head.join('')}</head>`,
      '<body>',
      toolbar,
      `<main class="packet">`,
      sections.join('\n'),
      '</main>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  /**
   * @typedef {{ timeZone: string, includeAttachments: boolean, attachmentUrl: HtmlRenderOptions['attachmentUrl'] | null, embeddedBytes: number }} RenderContext
   */

  /**
   * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportSection} section
   * @param {RenderContext} context
   */
  async #renderSection(section, context) {
    const letters = [];
    for (const letter of section.letters) letters.push(await this.#renderLetter(letter, context));
    return [
      '<section class="participant">',
      '<header class="participant-header">',
      `<h1>${escapeHtml(section.participant.displayName)}</h1>`,
      `<p>${escapeHtml(lettersLabel(section.letterCount))}</p>`,
      '</header>',
      letters.length === 0 ? '<p class="empty">No hay cartas para este participante.</p>' : letters.join('\n'),
      '</section>',
    ].join('\n');
  }

  /**
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {RenderContext} context
   */
  async #renderLetter(letter, context) {
    const sender = parseSenderName(letter.from) || letter.from || 'Remitente desconocido';
    const usedInline = new Set();
    const body = await this.#renderBody(letter, context, usedInline);
    const attachments = await this.#renderAttachments(letter, context, usedInline);
    return [
      '<article class="letter">',
      '<header class="letter-header">',
      `<p class="letter-meta">De: ${escapeHtml(sender)} · <time datetime="${escapeHtml(letter.receivedAt.toISOString())}">${escapeHtml(formatDateTime(letter.receivedAt, context.timeZone))}</time></p>`,
      `<h2 class="letter-subject">${escapeHtml(letter.subject || '(Sin asunto)')}</h2>`,
      '</header>',
      body,
      attachments,
      '</article>',
    ].join('\n');
  }

  /**
   * Body text with `[cid:…]` markers replaced by the inline images when attachments are included.
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {RenderContext} context
   * @param {Set<number>} usedInline
   */
  async #renderBody(letter, context, usedInline) {
    const text = letter.cleanBody;
    if (!context.includeAttachments) return `<div class="letter-body">${escapeHtml(text)}</div>`;
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(new RegExp(CID_MARKER.source, 'gi'))) {
      const index = letter.attachments.findIndex(
        (a) => a.contentId && a.contentId.toLowerCase() === match[1].toLowerCase() && classifyAttachment(a) === AttachmentKind.IMAGE,
      );
      if (index < 0) continue;
      parts.push(escapeHtml(text.slice(last, match.index)));
      parts.push(await this.#imageHtml(letter, index, context, 'letter-inline-image'));
      usedInline.add(index);
      last = /** @type {number} */ (match.index) + match[0].length;
    }
    parts.push(escapeHtml(text.slice(last)));
    return `<div class="letter-body">${parts.join('')}</div>`;
  }

  /**
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {RenderContext} context
   * @param {Set<number>} usedInline
   */
  async #renderAttachments(letter, context, usedInline) {
    if (letter.attachments.length === 0) return '';
    if (!context.includeAttachments) {
      return [
        '<ul class="letter-attachments">',
        ...letter.attachments.map((a) => `<li>Adjunto: ${escapeHtml(a.filename)} (${escapeHtml(formatBytes(a.size))})</li>`),
        '</ul>',
      ].join('');
    }

    const blocks = [];
    const notes = [];
    for (const [index, attachment] of letter.attachments.entries()) {
      if (usedInline.has(index)) continue;
      const name = escapeHtml(attachment.filename);
      const size = escapeHtml(formatBytes(attachment.size));
      const kind = classifyAttachment(attachment);
      if (kind === AttachmentKind.IMAGE) {
        blocks.push(await this.#imageHtml(letter, index, context, 'letter-image'));
      } else if (kind === AttachmentKind.DOCX) {
        blocks.push(await this.#documentHtml(letter, index));
      } else if (kind === AttachmentKind.PDF) {
        notes.push(`<li>PDF adjunto (imprímelo aparte): ${name} (${size})</li>`);
      } else if (kind === AttachmentKind.BLOCKED) {
        notes.push(`<li>Adjunto bloqueado por seguridad: ${name}</li>`);
      } else {
        notes.push(`<li>Adjunto no imprimible: ${name} (${size})</li>`);
      }
    }
    return [...blocks, notes.length > 0 ? `<ul class="letter-attachments">${notes.join('')}</ul>` : ''].join('\n');
  }

  /**
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {number} index
   * @param {RenderContext} context
   * @param {string} className
   */
  async #imageHtml(letter, index, context, className) {
    const attachment = letter.attachments[index];
    const alt = escapeHtml(`Imagen adjunta: ${attachment.filename}`);
    if (context.attachmentUrl) {
      const src = escapeHtml(context.attachmentUrl(letter.messageId, index, 'display'));
      return `<figure class="${className}"><img src="${src}" alt="${alt}" loading="lazy"></figure>`;
    }
    try {
      const content = await /** @type {any} */ (this.#attachments).getContent({ messageId: letter.messageId, attachment, variant: 'display' });
      if (context.embeddedBytes + content.data.length > this.#maxEmbeddedBytes) {
        return `<p class="attachment-note">Imagen no incluida para limitar el tamaño del archivo: ${escapeHtml(attachment.filename)}</p>`;
      }
      context.embeddedBytes += content.data.length;
      const src = `data:${content.mimeType};base64,${Buffer.from(content.data).toString('base64')}`;
      return `<figure class="${className}"><img src="${src}" alt="${alt}"></figure>`;
    } catch (error) {
      return `<p class="attachment-note">No se pudo incluir la imagen «${escapeHtml(attachment.filename)}»: ${escapeHtml(friendlyReason(error))}</p>`;
    }
  }

  /**
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {number} index
   */
  async #documentHtml(letter, index) {
    const attachment = letter.attachments[index];
    try {
      const text = await /** @type {any} */ (this.#attachments).extractText({ messageId: letter.messageId, attachment });
      return [
        '<section class="letter-document">',
        `<h3>Documento adjunto: ${escapeHtml(attachment.filename)}</h3>`,
        `<div class="letter-body">${escapeHtml(text)}</div>`,
        '</section>',
      ].join('');
    } catch (error) {
      return `<p class="attachment-note">No se pudo incluir el documento «${escapeHtml(attachment.filename)}»: ${escapeHtml(friendlyReason(error))}</p>`;
    }
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function friendlyReason(error) {
  const message = /** @type {{ message?: string, code?: string }} */ (error);
  return message?.code ? String(message.message) : describeError(error);
}
