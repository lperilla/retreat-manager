import { parseSenderName } from '../../domain/services/text.js';
import { formatBytes, formatDateTime, lettersLabel } from './format.js';

const RULE = '='.repeat(72);
const THIN_RULE = '-'.repeat(72);
/** Form feed: page break when the text file is printed. */
const PAGE_BREAK = '\f';

/**
 * ExportRendererPort adapter: plain-text packet (UTF-8). Participants are separated by a
 * form feed so each one starts on a new page when printed; bodies are never truncated.
 * @implements {import('../../application/ports/ExportRendererPort.js').ExportRendererPort}
 */
export class TxtRenderer {
  format = 'txt';

  extension = 'txt';

  mimeType = 'text/plain; charset=utf-8';

  /**
   * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportPayload} payload
   * @returns {Promise<string>}
   */
  async render(payload) {
    const { timeZone } = payload;
    const header = [
      'CARTAS DEL RETIRO',
      `Generado: ${formatDateTime(payload.generatedAt, timeZone)}`,
      `Participantes: ${payload.participantCount} · ${lettersLabel(payload.letterCount)}`,
      '',
    ].join('\n');

    const sections = payload.sections.map((section) => {
      const lines = [RULE, `${section.participant.displayName.toUpperCase()} (${lettersLabel(section.letterCount)})`, RULE, ''];
      if (section.letters.length === 0) {
        lines.push('No hay cartas para este participante.', '');
      }
      section.letters.forEach((letter, index) => {
        const sender = parseSenderName(letter.from) || letter.from || 'Remitente desconocido';
        lines.push(
          `Carta ${index + 1} de ${section.letters.length}`,
          THIN_RULE,
          `De: ${sender}`,
          `Fecha: ${formatDateTime(letter.receivedAt, timeZone)}`,
          `Asunto: ${letter.subject || '(Sin asunto)'}`,
          '',
          letter.cleanBody,
          '',
        );
        if (letter.attachments.length > 0) {
          lines.push(`Adjuntos: ${letter.attachments.map((a) => `${a.filename} (${formatBytes(a.size)})`).join(', ')}`, '');
        }
        lines.push('');
      });
      return lines.join('\n');
    });

    return `${header}\n${sections.join(`${PAGE_BREAK}\n`)}`;
  }
}
