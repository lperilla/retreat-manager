import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBatchExportPayload } from '../../src/domain/entities/BatchExportPayload.js';
import { computeContentHash } from '../../src/domain/entities/Letter.js';
import { extractMessageContent } from '../../src/infrastructure/gmail/bodyExtractor.js';
import { MAX_FORMATTED_BODY_CHARS, sanitizeLetterHtml, toFormattedBody } from '../../src/infrastructure/html/letterHtml.js';
import { HtmlPacketRenderer } from '../../src/infrastructure/rendering/HtmlPacketRenderer.js';
import { assignedTo, makeLetter } from '../helpers/domainFixtures.js';
import { b64url } from '../helpers/gmailFakes.js';

const STYLED =
  '<div dir="ltr"><p align="center" style="color:#c00;font-family:&quot;Comic Sans MS&quot;, cursive;font-size:18px">Querido <font color="blue" face="Verdana" size="5">Juan</font>:</p>' +
  '<p><b>¡Ánimo!</b> <span style="background-color: rgb(255, 255, 0)">Te queremos</span> 😊</p></div>';

describe('sanitizeLetterHtml', () => {
  it('keeps colours, fonts, sizes, emphasis and alignment, turning <font> and align into styles', () => {
    const html = sanitizeLetterHtml(STYLED);
    assert.match(html, /<p style="color:#c00;font-family:&quot;Comic Sans MS&quot;, cursive;font-size:18px;text-align:center">/);
    assert.match(html, /<span style="color:blue;font-family:Verdana;font-size:24px">Juan<\/span>/);
    assert.match(html, /<b>¡Ánimo!<\/b>/);
    assert.match(html, /background-color:rgb\(255, 255, 0\)/);
    assert.ok(html.includes('😊'));
  });

  it('removes scripts, event handlers, links, remote images, url() and positioning', () => {
    const html = sanitizeLetterHtml(
      '<style>p{color:red}</style><script>alert(1)</script>' +
        '<p style="background:url(https://track.example/p.gif);position:fixed;color:expression(alert(1))" onclick="x()">Hola</p>' +
        '<a href="javascript:alert(1)">enlace</a><img src="https://track.example/pixel.png"><img src="data:image/png;base64,AAAA">' +
        '<img src="cid:foto@x" onerror="alert(1)" width="2000"><iframe src="https://x"></iframe><svg><script>x</script></svg>',
    );
    assert.equal(/script|alert|onclick|onerror|url\(|position|expression|href|https:|data:|iframe|svg|width/i.test(html), false, html);
    assert.ok(html.includes('<p>Hola</p>'));
    assert.ok(html.includes('enlace'));
    assert.ok(html.includes('<img src="cid:foto@x" />'));
    assert.equal((html.match(/<img/g) ?? []).length, 1);
  });
});

describe('toFormattedBody', () => {
  it('is null when the HTML adds no formatting, is empty or too large', () => {
    assert.equal(toFormattedBody('<div dir="ltr">Hola Juan<br>Un beso</div>'), null);
    assert.equal(toFormattedBody('<div><b></b></div>'), null);
    assert.equal(toFormattedBody(`<p style="color:red">${'a'.repeat(MAX_FORMATTED_BODY_CHARS)}</p>`), null);
    assert.ok(toFormattedBody(STYLED));
  });

  it('joins several HTML parts (Apple Mail splits them around attachments)', () => {
    const html = toFormattedBody(['<p><i>Primera</i></p>', '<p><b>Segunda</b></p>']);
    assert.equal(html, '<p><i>Primera</i></p>\n<p><b>Segunda</b></p>');
  });
});

describe('extractMessageContent formatted body', () => {
  const part = (/** @type {string} */ mimeType, /** @type {string} */ text) => ({
    mimeType,
    headers: [{ name: 'Content-Type', value: `${mimeType}; charset=UTF-8` }],
    body: { data: b64url(text), size: text.length },
  });

  it('keeps the plain text for analysis and the sanitized HTML for printing', () => {
    const content = extractMessageContent({
      mimeType: 'multipart/alternative',
      parts: [part('text/plain', 'Querido Juan: ¡Ánimo!'), part('text/html', STYLED)],
    });
    assert.equal(content.body, 'Querido Juan: ¡Ánimo!');
    assert.match(content.formattedBody ?? '', /font-family:Verdana/);
  });

  it('has no formatted body for plain-text mail', () => {
    assert.equal(extractMessageContent(part('text/plain', 'Hola')).formattedBody, null);
  });
});

describe('Letter content hash with a formatted body', () => {
  it('only changes for letters that have one (existing hashes stay valid)', () => {
    const plain = makeLetter({ messageId: 'h1', cleanBody: 'Hola' });
    assert.equal(plain.contentHash, computeContentHash({ ...plain, formattedBody: undefined }));
    const formatted = makeLetter({ messageId: 'h1', cleanBody: 'Hola', formattedBody: '<p><b>Hola</b></p>' });
    assert.notEqual(formatted.contentHash, plain.contentHash);
    assert.equal(formatted.formattedBody, '<p><b>Hola</b></p>');
  });
});

describe('HtmlPacketRenderer original format', () => {
  const attachments = {
    getContent: async () => ({ data: Buffer.from('JPEGDATA'), mimeType: 'image/jpeg' }),
    extractText: async () => '',
  };
  const letter = makeLetter({
    messageId: 'f1',
    cleanBody: 'Querido Juan: ¡Ánimo! [cid:foto@x]',
    formattedBody: `${STYLED}<p><img src="cid:foto@x" /></p><script>alert(1)</script>`,
    attachments: [{ filename: 'foto.jpg', mimeType: 'image/jpeg', size: 8, contentId: 'foto@x', attachmentId: 'a1' }],
    assignment: assignedTo(['juan-perez']),
  });
  const payload = createBatchExportPayload({
    generatedAt: new Date('2026-11-21T10:00:00Z'),
    timeZone: 'Europe/Madrid',
    sections: [{ participant: { id: 'juan-perez', displayName: 'Juan Pérez' }, letters: [letter], letterCount: 1 }],
  });

  it("prints the e-mail's own formatting with its inline image once, sanitized again", async () => {
    const html = await new HtmlPacketRenderer({ attachments }).render(payload);
    assert.match(html, /<div class="letter-body letter-formatted">/);
    assert.match(html, /font-family:Verdana/);
    assert.match(html, /<img class="letter-formatted-image" src="data:image\/jpeg;base64,/);
    assert.equal((html.match(/data:image\/jpeg/g) ?? []).length, 1);
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.ok(html.includes('<p class="letter-recipient">Para: Juan Pérez</p>'));
  });

  it('falls back to the plain text when original format is off', async () => {
    const html = await new HtmlPacketRenderer({ attachments }).render(payload, { originalFormat: false });
    assert.equal(html.includes('letter-formatted"'), false);
    assert.equal(html.includes('font-family:Verdana'), false);
    assert.ok(html.includes('Querido Juan: ¡Ánimo!'));
  });

  it('drops cid images and lists them by name when attachments are not included', async () => {
    const html = await new HtmlPacketRenderer({ attachments }).render(payload, { includeAttachments: false });
    assert.match(html, /letter-formatted/);
    assert.equal(html.includes('cid:'), false);
    assert.ok(html.includes('Adjunto: foto.jpg'));
  });
});
