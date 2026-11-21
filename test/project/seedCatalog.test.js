/**
 * The Gmail test-letter set must behave exactly as documented: each letter's expected
 * assignment, suggestions and flags are checked against the real domain pipeline.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WARNING_FLAG_TYPES } from '../../src/domain/constants.js';
import { createAttachmentMeta } from '../../src/domain/entities/Letter.js';
import { createParticipant } from '../../src/domain/entities/Participant.js';
import { ContentAssignmentStrategy } from '../../src/domain/services/assignment.js';
import { computeFlags } from '../../src/domain/services/heuristics.js';
import { htmlToText } from '../../src/infrastructure/gmail/bodyExtractor.js';
import { SEED_LETTERS, SEED_PARTICIPANTS, SEED_QUERY, SEED_SENDER_DOMAIN, resolveDate } from '../../scripts/seed/catalog.js';
import { buildMime, encodeHeader, formatAddress } from '../../scripts/seed/mime.js';

const participants = SEED_PARTICIPANTS.map((p) => createParticipant(p));
const strategy = new ContentAssignmentStrategy();

describe('Gmail test-letter catalog', () => {
  it('has many letters with unique ids, all from the fictitious sender domain', () => {
    assert.ok(SEED_LETTERS.length >= 40, `${SEED_LETTERS.length} letters`);
    assert.equal(new Set(SEED_LETTERS.map((l) => l.id)).size, SEED_LETTERS.length);
    for (const letter of SEED_LETTERS) assert.ok(letter.from.address.endsWith(`@${SEED_SENDER_DOMAIN}`), letter.id);
    assert.equal(SEED_QUERY, 'from:familias-prueba.example');
  });

  for (const letter of SEED_LETTERS) {
    it(`${letter.id}: ${letter.tests}`, async () => {
      const attachments = letter.attachments ? await letter.attachments() : [];
      const body = letter.text?.trim() ? letter.text : letter.html ? htmlToText(letter.html) : letter.text ?? '';
      const from = formatAddress(letter.from);
      const assignment = strategy.assign({ subject: letter.subject, body, from }, participants);
      const metas = attachments.map((a) => createAttachmentMeta({ filename: a.filename, mimeType: a.mimeType, size: a.data.length, contentId: a.contentId }));
      const flags = computeFlags({ subject: letter.subject, body, from, headers: letter.headers ?? {}, attachments: metas, participantIds: assignment.participantIds });
      const flagTypes = flags.map((f) => f.type);

      assert.equal(assignment.status, letter.expect.status, `status (signals: ${JSON.stringify(assignment.matches)})`);
      if (letter.expect.participants) {
        assert.deepEqual([...assignment.participantIds].sort(), [...letter.expect.participants].sort());
      }
      if (letter.expect.suggestions) {
        if (letter.expect.suggestions.length === 0) assert.deepEqual(assignment.suggestedParticipantIds, []);
        else assert.deepEqual(assignment.suggestedParticipantIds.slice(0, letter.expect.suggestions.length), letter.expect.suggestions);
      }
      for (const flag of letter.expect.flags ?? []) assert.ok(flagTypes.includes(flag), `missing flag ${flag} (got ${flagTypes.join(', ')})`);
      const unexpectedWarnings = flagTypes.filter((t) => WARNING_FLAG_TYPES.includes(t) && !(letter.expect.flags ?? []).includes(t));
      assert.deepEqual(unexpectedWarnings, [], 'no unexpected warning flags');
    });
  }

  it('puts every letter in the past, with the midnight pair on both sides of 00:00 in Madrid', () => {
    const now = new Date('2026-11-22T10:00:00Z');
    for (const letter of SEED_LETTERS) assert.ok(resolveDate(letter.when, now) < now, letter.id);
    assert.equal(resolveDate([3, '23:50'], now).toISOString(), '2026-11-19T22:50:00.000Z');
    assert.equal(resolveDate([2, '00:10'], now).toISOString(), '2026-11-19T23:10:00.000Z');
  });

  it('gives every participant except two at least one assigned letter, and ties for most letters', () => {
    const counts = new Map(participants.map((p) => [p.id, 0]));
    for (const letter of SEED_LETTERS) for (const id of letter.expect.participants ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
    const zero = [...counts].filter(([, n]) => n === 0).map(([id]) => id).sort();
    assert.deepEqual(zero, ['claudia-molina', 'inigo-ezquerra']);
    const max = Math.max(...counts.values());
    assert.deepEqual([...counts].filter(([, n]) => n === max).map(([id]) => id).sort(), ['juan-martinez', 'lucia-fernandez']);
  });
});

describe('MIME builder', () => {
  it('encodes non-ASCII headers and builds multipart messages with inline images and attachments', async () => {
    assert.equal(encodeHeader('Hola'), 'Hola');
    assert.match(encodeHeader('Carta para Begoña'), /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
    assert.equal(formatAddress({ name: 'Rosa', address: 'r@x.example' }), '"Rosa" <r@x.example>');

    const letter = SEED_LETTERS.find((l) => l.id === 'imagen-incrustada');
    const attachments = await letter.attachments();
    const raw = buildMime({ ...letter, to: { address: 'buzon@example.com' }, date: new Date('2026-11-20T10:00:00Z'), attachments }).toString('utf8');
    assert.match(raw, /^From: "Clara Garc|^From: =\?UTF-8\?B\?/m);
    assert.match(raw, /Content-Type: multipart\/related; boundary=/);
    assert.match(raw, /Content-Type: multipart\/alternative; boundary=/);
    assert.match(raw, /Content-ID: <toby@familias-prueba\.example>/);
    assert.match(raw, /Date: Fri, 20 Nov 2026 10:00:00 \+0000/);

    const latin = SEED_LETTERS.find((l) => l.id === 'latin1');
    const latinRaw = buildMime({ ...latin, to: { address: 'b@example.com' }, date: new Date() }).toString('utf8');
    assert.match(latinRaw, /charset="iso-8859-1"/);
    const encoded = /charset="iso-8859-1"\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/.exec(latinRaw)?.[1] ?? '';
    assert.match(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('latin1'), /niña/);
  });
});
