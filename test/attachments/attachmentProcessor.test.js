import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import sharp from 'sharp';

import { createAttachmentMeta } from '../../src/domain/entities/Letter.js';
import { AttachmentProcessor, normalizeExtractedText } from '../../src/infrastructure/attachments/AttachmentProcessor.js';
import { detectFileType } from '../../src/infrastructure/attachments/fileSignature.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { DEMO_ATTACHMENT_ASSETS, DEMO_WAVES } from '../../src/infrastructure/persistence/json/demo/demoData.js';

const ASSETS = new URL('../../src/infrastructure/persistence/json/demo/assets/', import.meta.url);
const asset = (/** @type {string} */ name) => readFile(new URL(name, ASSETS));

/** @type {string} */
let cacheDir;
before(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'retreat-attachments-'));
});
after(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

/**
 * Fake AttachmentSourcePort returning fixed bytes per attachmentId and counting downloads.
 * @param {Record<string, Uint8Array>} files
 */
function fakeSource(files) {
  const calls = [];
  return {
    calls,
    async fetchAttachment({ attachment }) {
      calls.push(attachment.attachmentId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const data = files[attachment.attachmentId];
      if (!data) throw Object.assign(new Error('missing'), { code: 'ATTACHMENT_NOT_FOUND' });
      return data;
    },
  };
}

/**
 * @param {Record<string, unknown>} meta
 */
const meta = (meta) => createAttachmentMeta(meta);

/**
 * @param {ReturnType<typeof fakeSource>} source
 * @param {number} [maxBytes]
 */
const processor = (source, maxBytes = 15 * 1024 * 1024) =>
  new AttachmentProcessor({ source, cacheDir: join(cacheDir, String(Math.random()).slice(2)), maxBytes, logger: new NullLogger() });

describe('AttachmentProcessor images', () => {
  it('fixes EXIF orientation, strips metadata and produces display and thumbnail JPEGs', async () => {
    const scan = await asset('carta-abuela.jpg');
    const original = await sharp(scan).metadata();
    assert.equal(original.orientation, 6);
    assert.ok(original.width > original.height, 'stored rotated (landscape pixels)');

    const source = fakeSource({ a1: scan });
    const p = processor(source);
    const attachment = meta({ filename: 'carta-abuela.jpg', mimeType: 'image/jpeg', size: scan.length, attachmentId: 'a1' });

    const display = await p.getContent({ messageId: 'm1', attachment, variant: 'display' });
    const info = await sharp(display.data).metadata();
    assert.equal(display.mimeType, 'image/jpeg');
    assert.ok(info.height > info.width, 'displayed upright (portrait)');
    assert.ok(Math.max(info.width ?? 0, info.height ?? 0) <= 1600);
    assert.equal(info.orientation, undefined);
    assert.equal(info.exif, undefined);

    const thumb = await p.getContent({ messageId: 'm1', attachment, variant: 'thumbnail' });
    const thumbInfo = await sharp(thumb.data).metadata();
    assert.ok(Math.max(thumbInfo.width ?? 0, thumbInfo.height ?? 0) <= 320);
    assert.equal(source.calls.length, 1, 'the original is downloaded once and cached');
  });

  it('caches on disk and deduplicates concurrent downloads', async () => {
    const png = await asset('perro.png');
    const source = fakeSource({ p1: png });
    const p = processor(source);
    const attachment = meta({ filename: 'perro.png', mimeType: 'image/png', size: png.length, attachmentId: 'p1' });
    await Promise.all([
      p.getContent({ messageId: 'm2', attachment, variant: 'thumbnail' }),
      p.getContent({ messageId: 'm2', attachment, variant: 'display' }),
      p.getContent({ messageId: 'm2', attachment, variant: 'original' }),
    ]);
    await p.getContent({ messageId: 'm2', attachment, variant: 'thumbnail' });
    assert.equal(source.calls.length, 1);
  });

  it('reports HEIC images it cannot decode as not processable (download still possible)', async () => {
    const fakeHeic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(64)]);
    assert.equal(detectFileType(fakeHeic), 'heic');
    const p = processor(fakeSource({ h1: fakeHeic }));
    const attachment = meta({ filename: 'IMG_0001.HEIC', mimeType: 'image/heic', size: fakeHeic.length, attachmentId: 'h1' });
    await assert.rejects(p.getContent({ messageId: 'm3', attachment, variant: 'display' }), { code: 'ATTACHMENT_NOT_PROCESSABLE' });
    const original = await p.getContent({ messageId: 'm3', attachment, variant: 'original' });
    assert.equal(original.mimeType, 'image/heic');
  });
});

describe('AttachmentProcessor safety', () => {
  it('refuses blocked types without downloading them', async () => {
    const source = fakeSource({ s1: Buffer.from('<svg onload="alert(1)"></svg>') });
    const p = processor(source);
    const svg = meta({ filename: 'logo.svg', mimeType: 'image/svg+xml', size: 30, attachmentId: 's1' });
    await assert.rejects(p.getContent({ messageId: 'm', attachment: svg, variant: 'original' }), { code: 'ATTACHMENT_BLOCKED', httpStatus: 415 });
    assert.deepEqual(source.calls, []);
  });

  it('enforces MAX_ATTACHMENT_MB on metadata and on the downloaded bytes', async () => {
    const big = Buffer.alloc(2048, 1);
    const source = fakeSource({ b1: big });
    const p = processor(source, 1024);
    await assert.rejects(
      p.getContent({ messageId: 'm', attachment: meta({ filename: 'x.pdf', mimeType: 'application/pdf', size: 5000, attachmentId: 'b1' }), variant: 'original' }),
      { code: 'ATTACHMENT_TOO_LARGE', httpStatus: 413 },
    );
    assert.deepEqual(source.calls, []);
    await assert.rejects(
      p.getContent({ messageId: 'm', attachment: meta({ filename: 'x.pdf', mimeType: 'application/pdf', size: 100, attachmentId: 'b1' }), variant: 'original' }),
      { code: 'ATTACHMENT_TOO_LARGE' },
    );
  });

  it('serves files whose content does not match the declared type only as octet-stream downloads', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200)]);
    const p = processor(fakeSource({ e1: exe }));
    const disguised = meta({ filename: 'foto.png', mimeType: 'image/png', size: exe.length, attachmentId: 'e1' });
    const original = await p.getContent({ messageId: 'm', attachment: disguised, variant: 'original' });
    assert.equal(original.mimeType, 'application/octet-stream');
    assert.equal(original.verified, false);
    await assert.rejects(p.getContent({ messageId: 'm', attachment: disguised, variant: 'thumbnail' }), { code: 'ATTACHMENT_NOT_PROCESSABLE' });
  });

  it('serves verified PDFs as application/pdf and unsupported files as octet-stream', async () => {
    const pdf = await asset('carta-para-elena.pdf');
    const mov = await asset('video-familia.mov');
    const p = processor(fakeSource({ pdf, mov }));
    const pdfContent = await p.getContent({ messageId: 'm', attachment: meta({ filename: 'c.pdf', mimeType: 'application/pdf', size: pdf.length, attachmentId: 'pdf' }), variant: 'original' });
    assert.equal(pdfContent.mimeType, 'application/pdf');
    const movContent = await p.getContent({ messageId: 'm', attachment: meta({ filename: 'v.mov', mimeType: 'video/quicktime', size: mov.length, attachmentId: 'mov' }), variant: 'original' });
    assert.equal(movContent.mimeType, 'application/octet-stream');
  });
});

describe('AttachmentProcessor documents', () => {
  it('extracts DOCX text with mammoth and caches it', async () => {
    const docx = await asset('carta-diego.docx');
    const source = fakeSource({ d1: docx });
    const p = processor(source);
    const attachment = meta({ filename: 'Carta Diego.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: docx.length, attachmentId: 'd1' });
    const text = await p.extractText({ messageId: 'm', attachment });
    assert.match(text, /^Querido Diego:\n\nLlevo varios días/);
    assert.match(text, /Begoña$/);
    assert.equal(/\n{3,}/.test(text), false);
    await p.extractText({ messageId: 'm', attachment });
    assert.equal(source.calls.length, 1);
    await assert.rejects(p.extractText({ messageId: 'm', attachment: meta({ filename: 'a.pdf', mimeType: 'application/pdf', size: 10, attachmentId: 'x' }) }), {
      code: 'ATTACHMENT_NOT_PROCESSABLE',
    });
  });

  it('normalizes extracted text', () => {
    assert.equal(normalizeExtractedText('Hola\u0007 \r\n\r\n\r\n\r\nAdiós  '), 'Hola\n\nAdiós');
  });
});

describe('demo assets', () => {
  it('match the sizes and types declared in the demo dataset', async () => {
    const declared = DEMO_WAVES.flatMap((wave) => wave.letters).flatMap((letter) => letter.attachments);
    for (const attachment of declared) {
      const file = /** @type {Record<string, string>} */ (DEMO_ATTACHMENT_ASSETS)[attachment.attachmentId ?? ''];
      assert.ok(file, `asset for ${attachment.filename}`);
      const info = await stat(new URL(file, ASSETS));
      assert.equal(info.size, attachment.size, `${file} size`);
    }
    assert.equal(detectFileType(await asset('carta-diego.docx')), 'zip');
    assert.equal(detectFileType(await asset('carta-para-elena.pdf')), 'pdf');
  });
});
