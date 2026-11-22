import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { PDFDocument, degrees } from 'pdf-lib';

import { createBatchExportPayload } from '../../src/domain/entities/BatchExportPayload.js';
import { buildExportFilename } from '../../src/application/use-cases/ExportBatchLettersUseCase.js';
import { AttachmentsPdfRenderer, toWinAnsi } from '../../src/infrastructure/rendering/AttachmentsPdfRenderer.js';
import { assignedTo, makeLetter } from '../helpers/domainFixtures.js';

/**
 * @param {number} pages
 * @param {{ rotate?: number }} [options]
 */
async function samplePdf(pages, { rotate = 0 } = {}) {
  const document = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = document.addPage([595.28, 841.89]);
    if (rotate) page.setRotation(degrees(rotate));
  }
  return document.save();
}

const pdf = (/** @type {string} */ filename) => ({ filename, mimeType: 'application/pdf', size: 1000, attachmentId: filename });

/** Fake attachment processor: returns the bytes registered for each file name. */
function processor(/** @type {Record<string, { data: Uint8Array, verified?: boolean }>} */ files) {
  const requested = [];
  return {
    requested,
    classify: () => 'pdf',
    extractText: async () => '',
    getContent: async (/** @type {any} */ { attachment, variant }) => {
      requested.push(`${attachment.filename}:${variant}`);
      const file = files[attachment.filename];
      return { data: file.data, mimeType: 'application/pdf', filename: attachment.filename, verified: file.verified ?? true };
    },
  };
}

/**
 * @param {Array<{ participant: { id: string, displayName: string }, letters: any[] }>} sections
 */
function payloadOf(sections) {
  return createBatchExportPayload({
    generatedAt: new Date('2026-11-22T10:00:00Z'),
    timeZone: 'Europe/Madrid',
    sections: sections.map((s) => ({ ...s, letterCount: s.letters.length })),
  });
}

describe('AttachmentsPdfRenderer', () => {
  it('merges every PDF attachment in packet order, skips photos and replaces unreadable files by a note page', async () => {
    const files = {
      'carta.pdf': { data: await samplePdf(2) },
      'dibujo.pdf': { data: await samplePdf(1, { rotate: 90 }) },
      'roto.pdf': { data: new TextEncoder().encode('%PDF-1.4 esto no es un PDF de verdad') },
    };
    const attachments = processor(files);
    const carmen = makeLetter({
      messageId: 'm1',
      from: '"Tomás Delgado" <tomas@example.com>',
      receivedAt: '2026-11-20T10:00:00Z',
      attachments: [pdf('carta.pdf'), { filename: 'foto.jpg', mimeType: 'image/jpeg', size: 10, attachmentId: 'f' }],
      assignment: assignedTo(['carmen-delgado']),
    });
    const juan = makeLetter({
      messageId: 'm2',
      receivedAt: '2026-11-21T10:00:00Z',
      attachments: [pdf('dibujo.pdf'), pdf('roto.pdf')],
      assignment: assignedTo(['juan-perez']),
    });
    const bytes = await new AttachmentsPdfRenderer({ attachments }).render(
      payloadOf([
        { participant: { id: 'carmen-delgado', displayName: 'Carmen Delgado' }, letters: [carmen] },
        { participant: { id: 'juan-perez', displayName: 'Juan Pérez 😊' }, letters: [juan] },
      ]),
    );

    const merged = await PDFDocument.load(bytes);
    assert.equal(merged.getPageCount(), 4); // 2 + 1 + note page for the damaged file
    assert.equal(merged.getPage(2).getRotation().angle, 90); // original orientation kept
    assert.equal(merged.getTitle(), 'Adjuntos PDF del retiro (2 participantes)');
    assert.deepEqual(attachments.requested, ['carta.pdf:original', 'dibujo.pdf:original', 'roto.pdf:original']);
  });

  it('refuses files whose content is not a verified PDF (note page) and selections without PDFs', async () => {
    const attachments = processor({ 'falso.pdf': { data: await samplePdf(3), verified: false } });
    const letter = makeLetter({ messageId: 'm3', attachments: [pdf('falso.pdf')], assignment: assignedTo(['juan-perez']) });
    const renderer = new AttachmentsPdfRenderer({ attachments });
    const merged = await PDFDocument.load(
      await renderer.render(payloadOf([{ participant: { id: 'juan-perez', displayName: 'Juan Pérez' }, letters: [letter] }])),
    );
    assert.equal(merged.getPageCount(), 1);
    assert.equal(merged.getTitle(), 'Adjuntos PDF para Juan Pérez');

    const noPdf = makeLetter({ messageId: 'm4', assignment: assignedTo(['juan-perez']) });
    await assert.rejects(
      renderer.render(payloadOf([{ participant: { id: 'juan-perez', displayName: 'Juan Pérez' }, letters: [noPdf] }])),
      { code: 'NO_PDF_ATTACHMENTS', httpStatus: 422 },
    );
    await assert.rejects(new AttachmentsPdfRenderer({ attachments: null }).render(payloadOf([])), { code: 'ATTACHMENTS_UNAVAILABLE' });
  });

  it('keeps Spanish text and drops what the standard PDF fonts cannot draw', () => {
    assert.equal(toWinAnsi('Para: Íñigo «Ñu» – 😊 你好\tfin'), 'Para: Íñigo «Ñu» – fin');
  });

  it('names the file adjuntos_<scope>_<date>.pdf', () => {
    const payload = payloadOf([{ participant: { id: 'juan-perez', displayName: 'Juan Pérez' }, letters: [] }]);
    assert.equal(
      buildExportFilename(payload, 'pdf', new Date('2026-11-22T09:30:00Z'), 'Europe/Madrid', 'adjuntos'),
      'adjuntos_juan-perez_20261122-103000.pdf',
    );
  });
});
