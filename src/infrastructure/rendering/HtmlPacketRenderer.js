import { parseSenderName } from '../../domain/services/text.js';
import { escapeHtml, formatBytes, formatDateTime, lettersLabel } from './format.js';
import { PACKET_CSS } from './packetStyles.js';

/**
 * @typedef {Object} HtmlRenderOptions
 * @property {boolean} [includeAttachments]  Reserved for embedding printable attachments.
 * @property {string}  [stylesheetHref]      Link a stylesheet instead of embedding it (served print view).
 * @property {string}  [scriptHref]          Optional external script (served print view: print button).
 * @property {boolean} [toolbar]             Show the on-screen toolbar with the print button.
 */

/**
 * ExportRendererPort adapter: printable HTML packet, one section per participant with a
 * page break between participants. Every dynamic value is HTML-escaped; letter bodies are
 * rendered as text with `white-space: pre-wrap` (paragraphs, accents, ñ and emojis kept).
 * @implements {import('../../application/ports/ExportRendererPort.js').ExportRendererPort}
 */
export class HtmlPacketRenderer {
  format = 'html';

  extension = 'html';

  mimeType = 'text/html; charset=utf-8';

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

    const sections = payload.sections.map((section) => this.#renderSection(section, timeZone)).join('\n');

    return [
      '<!doctype html>',
      '<html lang="es">',
      `<head>${head.join('')}</head>`,
      '<body>',
      toolbar,
      `<main class="packet">`,
      sections,
      '</main>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  /**
   * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportSection} section
   * @param {string} timeZone
   */
  #renderSection(section, timeZone) {
    const letters =
      section.letters.length === 0
        ? '<p class="empty">No hay cartas para este participante.</p>'
        : section.letters.map((letter) => this.#renderLetter(letter, timeZone)).join('\n');
    return [
      '<section class="participant">',
      '<header class="participant-header">',
      `<h1>${escapeHtml(section.participant.displayName)}</h1>`,
      `<p>${escapeHtml(lettersLabel(section.letterCount))}</p>`,
      '</header>',
      letters,
      '</section>',
    ].join('\n');
  }

  /**
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {string} timeZone
   */
  #renderLetter(letter, timeZone) {
    const sender = parseSenderName(letter.from) || letter.from || 'Remitente desconocido';
    const attachments =
      letter.attachments.length === 0
        ? ''
        : [
            '<ul class="letter-attachments">',
            ...letter.attachments.map(
              (a) => `<li>Adjunto: ${escapeHtml(a.filename)} (${escapeHtml(formatBytes(a.size))})</li>`,
            ),
            '</ul>',
          ].join('');
    return [
      '<article class="letter">',
      '<header class="letter-header">',
      `<p class="letter-meta">De: ${escapeHtml(sender)} · <time datetime="${escapeHtml(letter.receivedAt.toISOString())}">${escapeHtml(formatDateTime(letter.receivedAt, timeZone))}</time></p>`,
      `<h2 class="letter-subject">${escapeHtml(letter.subject || '(Sin asunto)')}</h2>`,
      '</header>',
      `<div class="letter-body">${escapeHtml(letter.cleanBody)}</div>`,
      attachments,
      '</article>',
    ].join('\n');
  }
}
