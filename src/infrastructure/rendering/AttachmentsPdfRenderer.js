import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';

import { describeError } from '../../application/services/errorDescription.js';
import { AttachmentKind, classifyAttachment } from '../../domain/services/attachments.js';
import { AppError } from '../../domain/errors.js';
import { parseSenderName } from '../../domain/services/text.js';

/** A4 in PDF points. */
const A4 = /** @type {[number, number]} */ ([595.28, 841.89]);
const MARGIN = 56;
/** Characters outside Latin-1 that the standard PDF fonts (WinAnsi) can still draw. */
const WIN_ANSI_EXTRA = new Set(['€', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', 'Ž', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', 'ž', 'Ÿ']);

/**
 * Text the standard fonts can encode (emojis and other scripts are dropped).
 * @param {string} value
 * @returns {string}
 */
export function toWinAnsi(value) {
  return [...String(value ?? '')]
    .map((ch) => {
      const code = /** @type {number} */ (ch.codePointAt(0));
      if (code === 0x09 || code === 0x0a) return ' ';
      if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return '';
      return code <= 0xff || WIN_ANSI_EXTRA.has(ch) ? ch : '';
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ExportRendererPort adapter (phase 9): ONE printable PDF with every PDF attached to the
 * selected letters, merged in the same order as the letter packet (participants by name,
 * letters chronologically, attachments in their original order).
 *
 * - Photos and DOCX text are not repeated here: they are already printed with the letters.
 * - Each page gets a small footer «Para: … · De: … · archivo.pdf (página/total)» so a loose
 *   sheet can always be handed to the right person.
 * - A PDF that cannot be merged (password-protected, damaged, not really a PDF) is replaced
 *   by a note page, so nothing disappears silently.
 * - The merged file is built in memory; attachments come from the attachment processor
 *   (allowlist, content verification and disk cache).
 * @implements {import('../../application/ports/ExportRendererPort.js').ExportRendererPort}
 */
export class AttachmentsPdfRenderer {
  format = 'pdf';

  extension = 'pdf';

  mimeType = 'application/pdf';

  /** Export file names start with this prefix (adjuntos_<scope>_<date>.pdf). */
  filePrefix = 'adjuntos';

  #attachments;

  /**
   * @param {{ attachments: import('../../application/ports/AttachmentProcessorPort.js').AttachmentProcessorPort | null }} options
   */
  constructor({ attachments }) {
    this.#attachments = attachments;
  }

  /**
   * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportPayload} payload
   * @returns {Promise<Uint8Array>}
   */
  async render(payload) {
    const attachments = this.#attachments;
    if (!attachments) throw new AppError('ATTACHMENTS_UNAVAILABLE', 503);

    const merged = await PDFDocument.create();
    merged.setTitle(
      payload.participantCount === 1
        ? toWinAnsi(`Adjuntos PDF para ${payload.sections[0].participant.displayName}`)
        : `Adjuntos PDF del retiro (${payload.participantCount} participantes)`,
    );
    merged.setCreator('Gestión del retiro');
    merged.setProducer('Gestión del retiro');
    const font = await merged.embedFont(StandardFonts.Helvetica);
    const bold = await merged.embedFont(StandardFonts.HelveticaBold);
    let included = 0;

    for (const section of payload.sections) {
      const recipient = section.participant.displayName;
      for (const letter of section.letters) {
        const sender = parseSenderName(letter.from) || letter.from || 'Remitente desconocido';
        for (const attachment of letter.attachments) {
          if (classifyAttachment(attachment) !== AttachmentKind.PDF) continue;
          included += 1;
          const label = { recipient, sender, filename: attachment.filename };
          try {
            const content = await attachments.getContent({ messageId: letter.messageId, attachment, variant: 'original' });
            if (!content.verified) throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, 'El archivo no es un PDF válido.');
            const source = await PDFDocument.load(content.data, { ignoreEncryption: true, updateMetadata: false });
            if (source.isEncrypted) throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, 'El PDF está protegido con contraseña.');
            const pages = await merged.copyPages(source, source.getPageIndices());
            pages.forEach((page, index) => {
              merged.addPage(page);
              stampFooter(page, font, `${footerText(label)} (${index + 1}/${pages.length})`);
            });
          } catch (error) {
            addNotePage(merged, { font, bold }, label, reasonOf(error));
          }
        }
      }
    }

    if (included === 0) throw new AppError('NO_PDF_ATTACHMENTS', 422);
    return merged.save();
  }
}

/**
 * @param {{ recipient: string, sender: string, filename: string }} label
 */
function footerText({ recipient, sender, filename }) {
  return toWinAnsi(`Para: ${recipient} · De: ${sender} · ${filename}`);
}

/**
 * Small grey footer in the bottom margin, upright whatever the page rotation.
 * @param {import('pdf-lib').PDFPage} page
 * @param {import('pdf-lib').PDFFont} font
 * @param {string} text
 */
function stampFooter(page, font, text) {
  const size = 7;
  const { x, y, width, height } = page.getMediaBox();
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const maxWidth = (rotation === 90 || rotation === 270 ? height : width) - 2 * 24;
  let line = text;
  while (line.length > 8 && font.widthOfTextAtSize(line, size) > maxWidth) line = `${line.slice(0, -2)}…`;
  const options = { size, font, color: rgb(0.45, 0.45, 0.45) };
  // Place the text along the edge that is at the bottom once the viewer applies /Rotate.
  if (rotation === 90) page.drawText(line, { ...options, x: x + 12, y: y + 24, rotate: degrees(90) });
  else if (rotation === 180) page.drawText(line, { ...options, x: x + width - 24, y: y + height - 12, rotate: degrees(180) });
  else if (rotation === 270) page.drawText(line, { ...options, x: x + width - 12, y: y + height - 24, rotate: degrees(270) });
  else page.drawText(line, { ...options, x: x + 24, y: y + 12 });
}

/**
 * Note page for a PDF that could not be merged.
 * @param {PDFDocument} document
 * @param {{ font: import('pdf-lib').PDFFont, bold: import('pdf-lib').PDFFont }} fonts
 * @param {{ recipient: string, sender: string, filename: string }} label
 * @param {string} reason
 */
function addNotePage(document, { font, bold }, label, reason) {
  const page = document.addPage(A4);
  const top = A4[1] - MARGIN;
  page.drawText(toWinAnsi(`Para: ${label.recipient}`), { x: MARGIN, y: top, size: 11, font, color: rgb(0.48, 0.36, 0.18) });
  page.drawText('No se ha podido incluir este PDF adjunto', { x: MARGIN, y: top - 28, size: 16, font: bold });
  const lines = [`Archivo: ${label.filename}`, `De: ${label.sender}`, `Motivo: ${reason}`, '', 'Ábrelo desde la carta en el panel e imprímelo aparte.'];
  lines.forEach((text, index) => {
    page.drawText(toWinAnsi(text), { x: MARGIN, y: top - 60 - index * 18, size: 11, font, maxWidth: A4[0] - 2 * MARGIN });
  });
  stampFooter(page, font, footerText(label));
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function reasonOf(error) {
  if (error instanceof AppError) return error.message;
  const message = String(/** @type {Error} */ (error)?.message ?? '');
  if (/encrypt/i.test(message)) return 'El PDF está protegido con contraseña.';
  if (/parse|invalid|header|xref|trailer/i.test(message)) return 'El PDF está dañado o no se puede leer.';
  return describeError(error);
}
