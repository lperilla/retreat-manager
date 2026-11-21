import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AttachmentKind, DOCX_MIME, classifyAttachment, fileExtension, isInlineImage } from '../../src/domain/services/attachments.js';

const kind = (filename, mimeType) => classifyAttachment({ filename, mimeType });

describe('classifyAttachment', () => {
  it('accepts the allowlisted images, PDF and DOCX', () => {
    for (const [file, mime] of [
      ['carta.jpg', 'image/jpeg'],
      ['foto.PNG', 'image/png'],
      ['a.webp', 'image/webp'],
      ['b.gif', 'image/gif'],
      ['IMG_0001.HEIC', 'image/heic'],
      ['scan.jpeg', 'application/octet-stream'],
    ]) {
      assert.equal(kind(file, mime), AttachmentKind.IMAGE, file);
    }
    assert.equal(kind('carta.pdf', 'application/pdf'), AttachmentKind.PDF);
    assert.equal(kind('carta.pdf', 'application/octet-stream'), AttachmentKind.PDF);
    assert.equal(kind('Carta Diego.docx', DOCX_MIME), AttachmentKind.DOCX);
    assert.equal(kind('carta.docx', 'application/zip'), AttachmentKind.DOCX);
  });

  it('rejects SVG, executables, scripts, HTML and macro documents', () => {
    for (const [file, mime] of [
      ['logo.svg', 'image/svg+xml'],
      ['dibujo.png', 'image/svg+xml'],
      ['setup.exe', 'application/x-msdownload'],
      ['foto.jpg.exe', 'application/octet-stream'],
      ['script.js', 'text/javascript'],
      ['pagina.html', 'text/html'],
      ['factura.docm', 'application/vnd.ms-word.document.macroEnabled.12'],
      ['run.bat', 'application/octet-stream'],
    ]) {
      assert.equal(kind(file, mime), AttachmentKind.BLOCKED, `${file} (${mime})`);
    }
  });

  it('marks anything else as unsupported (download only)', () => {
    assert.equal(kind('video-familia.mov', 'video/quicktime'), AttachmentKind.UNSUPPORTED);
    assert.equal(kind('fotos.zip', 'application/zip'), AttachmentKind.UNSUPPORTED);
    assert.equal(kind('carta.doc', 'application/msword'), AttachmentKind.UNSUPPORTED);
  });

  it('detects inline images and extensions', () => {
    assert.equal(isInlineImage({ filename: 'perro.png', mimeType: 'image/png', contentId: 'perro@x' }), true);
    assert.equal(isInlineImage({ filename: 'carta.pdf', mimeType: 'application/pdf', contentId: 'x' }), false);
    assert.equal(isInlineImage({ filename: 'perro.png', mimeType: 'image/png', contentId: null }), false);
    assert.equal(fileExtension('Carta.Para.Ana.PDF'), '.pdf');
    assert.equal(fileExtension('sin-extension'), '');
  });
});
