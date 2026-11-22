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
import { toFormattedBody } from '../../src/infrastructure/html/letterHtml.js';
import { ageOn, createParticipantRecord, missingFields } from '../../src/modules/participants/domain/ParticipantRecord.js';
import { SEED_LETTERS, SEED_PARTICIPANTS, SEED_QUERY, SEED_SENDER_DOMAIN, resolveDate } from '../../scripts/seed/catalog.js';
import { currentParticipants, loadSeedParticipants, seedParticipantRecords } from '../../scripts/seed/loadParticipants.js';
import { buildMime, encodeHeader, formatAddress } from '../../scripts/seed/mime.js';
import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { createAssignment } from '../../src/modules/accommodation/domain/accommodation.js';

// Same shape as the dashboard's directory: display name, aliases and structured name parts.
const participants = SEED_PARTICIPANTS.map((p) =>
  createParticipant({ displayName: p.displayName, aliases: p.aliases, nameParts: { givenNames: p.profile.givenNames, firstSurname: p.profile.firstSurname, secondSurname: null } }),
);
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
    assert.deepEqual(zero, ['claudio-molina', 'inigo-ezquerra']);
    const max = Math.max(...counts.values());
    assert.deepEqual([...counts].filter(([, n]) => n === max).map(([id]) => id).sort(), ['juan-martinez', 'lucas-fernandez']);
  });
});

describe('rich test letters and participant profiles', () => {
  it('has a dozen illustrated letters whose HTML keeps fonts, colours and inline images after sanitizing', async () => {
    const richLetters = SEED_LETTERS.filter((l) => l.id.startsWith('rica-'));
    assert.ok(richLetters.length >= 12, `${richLetters.length} rich letters`);
    for (const letter of richLetters) {
      const formatted = toFormattedBody([letter.html ?? '']) ?? '';
      assert.match(formatted, /font-family/, letter.id);
      assert.match(formatted, /color:/, letter.id);
      const attachments = letter.attachments ? await letter.attachments() : [];
      for (const image of attachments.filter((a) => a.contentId)) {
        assert.ok(formatted.includes(`cid:${image.contentId}`), `${letter.id}: ${image.contentId} kept in place`);
        assert.ok(image.data.length > 5000, `${letter.id}: ${image.filename} is a real picture`);
      }
    }
  });

  it('gives every participant a valid, complete profile with a nationality (adult men)', () => {
    for (const p of SEED_PARTICIPANTS) {
      const record = createParticipantRecord({ ...p.profile, id: 'x', retreatId: 'r', createdAt: '2026-11-01T00:00:00Z' });
      assert.equal(record.displayName, p.displayName);
      assert.ok(record.nationality, p.displayName);
      assert.deepEqual(missingFields(record), [], p.displayName);
      assert.ok((ageOn(record, '2026-11-22') ?? 0) >= 25, p.displayName);
    }
    assert.ok(new Set(SEED_PARTICIPANTS.map((p) => p.profile.nationality)).size >= 5);
  });
});

describe('--load-participants', () => {
  it('replaces the active retreat participants with the full test profiles and releases rooms and tables of the removed ones', async () => {
    const now = new Date('2026-11-22T10:00:00Z');
    const persistence = createJsonPersistence({ directory: null, clock: { now: () => now } });
    const { retreat } = await currentParticipants({ persistence, now });
    await persistence.participantRecords.save(createParticipantRecord({ id: 'maria-garcia', retreatId: retreat.id, givenNames: 'María', firstSurname: 'García', createdAt: now }));
    await persistence.roomAssignments.save(createAssignment({ retreatId: retreat.id, participantId: 'maria-garcia', targetId: 'hab-1', assignedAt: now }));
    await persistence.tableAssignments.save(createAssignment({ retreatId: retreat.id, participantId: 'maria-garcia', targetId: 'mesa-1', assignedAt: now }));

    const result = await loadSeedParticipants({ persistence, now });
    assert.deepEqual(result.removed, ['maria-garcia']);
    const stored = await persistence.participantRecords.findByRetreat(retreat.id);
    assert.equal(stored.length, SEED_PARTICIPANTS.length);
    const curro = stored.find((r) => r.id === 'francisco-jose-torres');
    assert.equal(curro?.displayName, 'Francisco José Torres');
    assert.deepEqual(curro?.aliases, ['Curro']);
    assert.equal(stored.find((r) => r.id === 'carlos-delgado')?.nationality, 'Perú');
    assert.equal(stored.find((r) => r.id === 'carlos-delgado')?.dietary[0].severity, 'severe');
    assert.equal(await persistence.roomAssignments.findByParticipant('maria-garcia'), null);
    assert.equal(await persistence.tableAssignments.findByParticipant('maria-garcia'), null);
    assert.deepEqual(seedParticipantRecords({ retreatId: retreat.id, now }).map((r) => r.id).sort(), stored.map((r) => r.id).sort());
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
    assert.match(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64').toString('latin1'), /niño/);
  });
});
