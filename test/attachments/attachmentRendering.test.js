import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createBatchExportPayload } from '../../src/domain/entities/BatchExportPayload.js';
import { createLetter } from '../../src/domain/entities/Letter.js';
import { AttachmentProcessor } from '../../src/infrastructure/attachments/AttachmentProcessor.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { DemoMailSource } from '../../src/infrastructure/persistence/json/DemoMailSource.js';
import { DEMO_WAVES } from '../../src/infrastructure/persistence/json/demo/demoData.js';
import { HtmlPacketRenderer } from '../../src/infrastructure/rendering/HtmlPacketRenderer.js';
import { assignedTo } from '../helpers/domainFixtures.js';

/** @type {string} */
let cacheDir;
before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'retreat-render-attachments-'));
});
after(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/**
 * Demo letters with attachments, as stored letters.
 * @param {string[]} ids
 */
function demoLetters(ids) {
  const messages = DEMO_WAVES.flatMap((wave) => wave.letters).filter((m) => ids.includes(m.messageId));
  return messages.map((m) =>
    createLetter({
      messageId: m.messageId,
      from: m.from,
      subject: m.subject,
      receivedAt: m.receivedAt,
      cleanBody: m.body,
      attachments: m.attachments,
      assignment: assignedTo(['p']),
    }),
  );
}

function payloadFor(letters) {
  return createBatchExportPayload({
    generatedAt: new Date('2026-11-21T10:00:00Z'),
    timeZone: 'Europe/Madrid',
    sections: [{ participant: { id: 'p', displayName: 'Participante' }, letters, letterCount: letters.length }],
  });
}

function renderer() {
  const processor = new AttachmentProcessor({ source: new DemoMailSource(), cacheDir, maxBytes: 15 * 1024 * 1024, logger: new NullLogger() });
  return new HtmlPacketRenderer({ attachments: processor });
}

describe('HTML packet with attachments', () => {
  it('embeds images, prints DOCX text and lists PDFs and unsupported files', async () => {
    const html = await renderer().render(payloadFor(demoLetters(['demo-w1-12', 'demo-w1-13', 'demo-w1-14', 'demo-w1-15'])), { includeAttachments: true });
    assert.match(html, /<img src="data:image\/jpeg;base64,[A-Za-z0-9+/=]{1000,}" alt="Imagen adjunta: carta-abuela\.jpg">/);
    assert.match(html, /Documento adjunto: Carta Diego\.docx<\/h3><div class="letter-body">Querido Diego:/);
    assert.match(html, /PDF adjunto \(imprímelo aparte\): carta-para-elena\.pdf/);
    assert.match(html, /Adjunto no imprimible: video-familia\.mov/);
  });

  it('replaces [cid:…] markers with the inline image inside the body', async () => {
    const html = await renderer().render(payloadFor(demoLetters(['demo-w1-23'])), { includeAttachments: true });
    assert.equal(html.includes('[cid:perro@demo]'), false);
    assert.match(html, /<div class="letter-body">[^]*Mira quién te espera:\n\n<figure class="letter-inline-image"><img src="data:image\/jpeg;base64,/);
    assert.equal((html.match(/<figure/g) ?? []).length, 1, 'the inline image is not repeated as an attachment');
  });

  it('only lists attachments when includeAttachments is false, and links images in the served print view', async () => {
    const letters = demoLetters(['demo-w1-12', 'demo-w1-23']);
    const plain = await renderer().render(payloadFor(letters), { includeAttachments: false });
    assert.equal(plain.includes('data:image'), false);
    assert.ok(plain.includes('Adjunto: carta-abuela.jpg'));
    assert.ok(plain.includes('[cid:perro@demo]'));

    const served = await renderer().render(payloadFor(letters), {
      includeAttachments: true,
      attachmentUrl: (messageId, index, variant) => `/api/letters/${messageId}/attachments/${index}?variant=${variant}`,
    });
    assert.ok(served.includes('<img src="/api/letters/demo-w1-12/attachments/0?variant=display"'));
    assert.equal(served.includes('data:image'), false);
  });

  it('notes attachments that cannot be included instead of failing the export', async () => {
    const broken = createLetter({
      messageId: 'x',
      receivedAt: '2026-11-20T10:00:00Z',
      cleanBody: 'Hola',
      attachments: [{ filename: 'roto.jpg', mimeType: 'image/jpeg', size: 10, attachmentId: 'does-not-exist' }],
      assignment: assignedTo(['p']),
    });
    const html = await renderer().render(payloadFor([broken]), { includeAttachments: true });
    assert.match(html, /No se pudo incluir la imagen «roto\.jpg»: Adjunto no encontrado\./);
  });
});
