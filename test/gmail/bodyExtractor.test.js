import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decodeBody, extractMessageContent, headerMap, htmlToText } from '../../src/infrastructure/gmail/bodyExtractor.js';
import { b64url } from '../helpers/gmailFakes.js';

const textPart = (text, contentType = 'text/plain; charset=UTF-8') => ({
  mimeType: contentType.split(';')[0],
  headers: [{ name: 'Content-Type', value: contentType }],
  body: { data: b64url(text), size: text.length },
});

describe('extractMessageContent', () => {
  it('prefers text/plain over text/html in multipart/alternative', () => {
    const content = extractMessageContent({
      mimeType: 'multipart/alternative',
      parts: [textPart('Querido Juan:\n\nÁnimo 😊'), textPart('<p>Versión <b>HTML</b></p>', 'text/html; charset=UTF-8')],
    });
    assert.equal(content.bodySource, 'text/plain');
    assert.equal(content.body, 'Querido Juan:\n\nÁnimo 😊');
  });

  it('converts HTML-only mail to clean text, keeping paragraphs and dropping scripts, styles and images', () => {
    const html = [
      '<html><head><style>p{color:red}</style><title>x</title></head><body>',
      '<div>Querida Lucía:</div><div><br></div>',
      '<p>Te queremos &amp; te echamos de menos.&nbsp;¡Ánimo!</p>',
      '<script>alert(1)</script><img src="https://tracker.example/pixel.gif" alt="">',
      '<ul><li>Uno</li><li>Dos</li></ul>',
      '<p>Un abrazo,<br>Mamá</p></body></html>',
    ].join('');
    const content = extractMessageContent({ mimeType: 'text/html', headers: [{ name: 'Content-Type', value: 'text/html; charset=UTF-8' }], body: { data: b64url(html) } });
    assert.equal(content.bodySource, 'text/html');
    assert.equal(content.body, 'Querida Lucía:\n\nTe queremos & te echamos de menos. ¡Ánimo!\n\n• Uno\n• Dos\n\nUn abrazo,\nMamá');
    assert.equal(/alert|tracker|color:red|<|>/.test(content.body), false);
  });

  it('walks nested parts, collects attachment metadata (incl. inline cid images) and ignores text attachments as body', () => {
    const content = extractMessageContent({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/related',
          parts: [
            { mimeType: 'multipart/alternative', parts: [textPart('Hola Pedro')] },
            {
              mimeType: 'image/png',
              filename: '',
              headers: [{ name: 'Content-ID', value: '<firma@x>' }, { name: 'Content-Disposition', value: 'inline' }],
              body: { attachmentId: 'att-inline', size: 2048 },
            },
          ],
        },
        { mimeType: 'application/pdf', filename: 'carta.pdf', body: { attachmentId: 'att-pdf', size: 480000 } },
        { mimeType: 'text/plain', filename: 'notas.txt', headers: [{ name: 'Content-Disposition', value: 'attachment; filename="notas.txt"' }], body: { attachmentId: 'att-txt', size: 10 } },
      ],
    });
    assert.equal(content.body, 'Hola Pedro');
    assert.deepEqual(content.attachments, [
      { filename: 'imagen-firma@x', mimeType: 'image/png', size: 2048, contentId: 'firma@x', attachmentId: 'att-inline' },
      { filename: 'carta.pdf', mimeType: 'application/pdf', size: 480000, contentId: null, attachmentId: 'att-pdf' },
      { filename: 'notas.txt', mimeType: 'text/plain', size: 10, contentId: null, attachmentId: 'att-txt' },
    ]);
  });

  it('returns an empty body for attachment-only messages', () => {
    const content = extractMessageContent({
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'image/jpeg', filename: 'escaneo.jpg', body: { attachmentId: 'a1', size: 1_000_000 } }],
    });
    assert.equal(content.body, '');
    assert.equal(content.bodySource, 'none');
    assert.equal(content.attachments.length, 1);
  });
});

describe('decoding helpers', () => {
  it('decodes base64url with the declared charset', () => {
    const latin1 = Buffer.from('Querida Begoña, ¡ánimo!', 'latin1').toString('base64url');
    assert.equal(decodeBody(latin1, 'text/plain; charset="ISO-8859-1"'), 'Querida Begoña, ¡ánimo!');
    assert.equal(decodeBody(b64url('Niño 😊'), 'text/plain'), 'Niño 😊');
    assert.equal(decodeBody(undefined), '');
  });

  it('decodes numeric and named entities', () => {
    assert.equal(htmlToText('<p>Ni&ntilde;o &#128522; &#x00e1; &laquo;hola&raquo;</p>'), 'Niño 😊 á «hola»');
  });

  it('builds a lower-case header map', () => {
    assert.deepEqual(
      headerMap({ headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }, { name: 'List-Unsubscribe', value: '<x>' }] }),
      { 'auto-submitted': 'auto-replied', 'list-unsubscribe': '<x>' },
    );
  });
});
