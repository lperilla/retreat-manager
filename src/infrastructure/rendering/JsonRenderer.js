/**
 * ExportRendererPort adapter producing a JSON document per batch.
 * @implements {import('../../application/ports/ExportRendererPort.js').ExportRendererPort}
 */
export class JsonRenderer {
  format = 'json';

  extension = 'json';

  mimeType = 'application/json; charset=utf-8';

  /**
   * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportPayload} payload
   * @returns {Promise<string>}
   */
  async render(payload) {
    const document = {
      generatedAt: payload.generatedAt.toISOString(),
      timeZone: payload.timeZone,
      participantCount: payload.participantCount,
      letterCount: payload.letterCount,
      uniqueLetterCount: payload.uniqueLetterCount,
      participants: payload.sections.map((section) => ({
        id: section.participant.id,
        displayName: section.participant.displayName,
        letterCount: section.letterCount,
        letters: section.letters.map((letter) => ({
          messageId: letter.messageId,
          receivedAt: letter.receivedAt.toISOString(),
          from: letter.from,
          subject: letter.subject,
          body: letter.cleanBody,
          attachments: letter.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size })),
          flags: letter.flags.map((f) => ({ type: f.type, confidence: f.confidence, reason: f.reason })),
          assignment: {
            signal: letter.assignment.signal,
            confidence: letter.assignment.confidence,
            matchedText: letter.assignment.matchedText,
            participantIds: [...letter.assignment.participantIds],
          },
        })),
      })),
    };
    return `${JSON.stringify(document, null, 2)}\n`;
  }
}
