import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createBatchExportPayload } from '../../src/domain/entities/BatchExportPayload.js';
import { HtmlPacketRenderer } from '../../src/infrastructure/rendering/HtmlPacketRenderer.js';
import { JsonRenderer } from '../../src/infrastructure/rendering/JsonRenderer.js';
import { TxtRenderer } from '../../src/infrastructure/rendering/TxtRenderer.js';
import { escapeHtml, formatBytes } from '../../src/infrastructure/rendering/format.js';
import { assignedTo, makeLetter } from '../helpers/domainFixtures.js';

const BODY = 'Querida Begoña:\n\nQué ilusión verte 😊\n\n¡Ánimo! Un abrazo,\nMamá';

function payload() {
  const letter = makeLetter({
    messageId: 'p1',
    from: '"Rosa Martín" <rosa@example.com>',
    subject: 'Carta para <script>alert(1)</script> Begoña',
    cleanBody: `${BODY}\n<img src=x onerror=alert(1)>`,
    receivedAt: '2026-11-18T22:50:00Z',
    attachments: [{ filename: 'carta.pdf', mimeType: 'application/pdf', size: 486120 }],
    assignment: assignedTo(['juan-perez']),
  });
  return createBatchExportPayload({
    generatedAt: new Date('2026-11-21T10:00:00Z'),
    timeZone: 'Europe/Madrid',
    sections: [
      { participant: { id: 'juan-perez', displayName: 'Juan Pérez' }, letters: [letter], letterCount: 1 },
      { participant: { id: 'hugo', displayName: 'Hugo <b>Serrano</b>' }, letters: [], letterCount: 0 },
    ],
  });
}

describe('HtmlPacketRenderer', () => {
  it('escapes every dynamic value and keeps the body as pre-wrap text', async () => {
    const html = await new HtmlPacketRenderer().render(payload());
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.equal(html.includes('<img src=x'), false);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.ok(html.includes('Hugo &lt;b&gt;Serrano&lt;/b&gt;'));
    assert.ok(html.includes('Querida Begoña:\n\nQué ilusión verte 😊'));
    assert.ok(html.includes('white-space: pre-wrap'));
  });

  it('hides the participant title, letter count and empty notice on paper and avoids breaking letter headers', async () => {
    const html = await new HtmlPacketRenderer().render(payload());
    assert.equal((html.match(/<section class="participant">/g) ?? []).length, 2);
    assert.match(html, /\.participant-header, \.participant > \.empty \{ display: none !important; \}/);
    assert.ok(html.includes('break-inside: avoid'));
    // Still on screen, to find your way around the packet.
    assert.ok(html.includes('No hay cartas para este participante.'));
    assert.ok(html.includes('<h1>Juan Pérez</h1>'));
  });

  it('prints every letter on its own sheet with its own recipient line', async () => {
    const letters = ['a', 'b', 'c'].map((id, i) =>
      makeLetter({ messageId: id, receivedAt: `2026-11-1${i + 1}T10:00:00Z`, assignment: assignedTo(['juan-perez']) }),
    );
    const html = await new HtmlPacketRenderer().render(
      createBatchExportPayload({
        generatedAt: new Date('2026-11-21T10:00:00Z'),
        timeZone: 'Europe/Madrid',
        sections: [{ participant: { id: 'juan-perez', displayName: 'Juan Pérez' }, letters, letterCount: 3 }],
      }),
    );
    assert.match(html, /\.letter \{ break-before: page; page-break-before: always; \}/);
    assert.equal((html.match(/<article class="letter">/g) ?? []).length, 3);
    assert.equal((html.match(/<p class="letter-recipient">Para: Juan Pérez<\/p>/g) ?? []).length, 3);
  });

  it('shows the sender name, the local date (Europe/Madrid) and attachments', async () => {
    const html = await new HtmlPacketRenderer().render(payload());
    assert.ok(html.includes('De: Rosa Martín'));
    assert.equal(html.includes('rosa@example.com'), false);
    assert.match(html, /miércoles, 18 de noviembre de 2026, 23:50/);
    assert.ok(html.includes('Adjunto: carta.pdf (474,7 KB)'));
  });

  it('embeds the stylesheet for exported files and links it for the served print view', async () => {
    const renderer = new HtmlPacketRenderer();
    const standalone = await renderer.render(payload());
    assert.ok(standalone.includes('<style>'));
    assert.equal(standalone.includes('<script'), false);

    const served = await renderer.render(payload(), { stylesheetHref: '/css/packet.css', scriptHref: '/js/print-page.js', toolbar: true });
    assert.equal(served.includes('<style>'), false);
    assert.ok(served.includes('<link rel="stylesheet" href="/css/packet.css">'));
    assert.ok(served.includes('<script type="module" src="/js/print-page.js"></script>'));
    assert.ok(served.includes('data-action="print"'));
    assert.match(served, /^<!doctype html>\n<html lang="es">/);
  });
});

describe('TxtRenderer', () => {
  it('writes every letter in full and separates participants with a form feed', async () => {
    const text = await new TxtRenderer().render(payload());
    assert.ok(text.startsWith('CARTAS DEL RETIRO'));
    assert.ok(text.includes('JUAN PÉREZ (1 carta)'));
    assert.ok(text.includes(BODY));
    assert.ok(text.includes('De: Rosa Martín'));
    assert.ok(text.includes('Adjuntos: carta.pdf'));
    assert.equal(text.split('\f').length, 2);
    assert.ok(text.includes('No hay cartas para este participante.'));
  });
});

describe('JsonRenderer', () => {
  it('produces parseable JSON with ISO dates', async () => {
    const document = JSON.parse(await new JsonRenderer().render(payload()));
    assert.equal(document.participants.length, 2);
    assert.equal(document.participants[0].letters[0].receivedAt, '2026-11-18T22:50:00.000Z');
    assert.equal(document.participants[0].letters[0].body.startsWith('Querida Begoña'), true);
  });
});

describe('format helpers', () => {
  it('escapes HTML and formats sizes in Spanish', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1843221), '1,8 MB');
  });
});
