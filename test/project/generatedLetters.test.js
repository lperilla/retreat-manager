/**
 * Letters generated for the participants already in the retreat (`seed-gmail.js --generated`):
 * about the requested amount, varied, unevenly spread, and every expectation true for the real
 * recognition pipeline.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { WARNING_FLAG_TYPES } from '../../src/domain/constants.js';
import { createAttachmentMeta } from '../../src/domain/entities/Letter.js';
import { ContentAssignmentStrategy } from '../../src/domain/services/assignment.js';
import { computeFlags } from '../../src/domain/services/heuristics.js';
import { htmlToText } from '../../src/infrastructure/gmail/bodyExtractor.js';
import { createParticipantRecord } from '../../src/modules/participants/domain/ParticipantRecord.js';
import { toLettersParticipant } from '../../src/modules/participants/infrastructure/ParticipantDirectory.js';
import { SEED_SENDER_DOMAIN } from '../../scripts/seed/catalog.js';
import { generateLetters } from '../../scripts/seed/generated.js';
import { seedParticipantRecords } from '../../scripts/seed/loadParticipants.js';
import { formatAddress } from '../../scripts/seed/mime.js';

const now = new Date('2026-11-22T10:00:00Z');
const record = (/** @type {Record<string, any>} */ props) => createParticipantRecord({ retreatId: 'r1', createdAt: now, ...props });

/** A retreat like a real one: shared first names, an alias, a name in capitals, one withdrawn. */
const MIXED = Object.freeze([
  ...['Álvaro Herrera', 'Diego Navarro', 'Hugo Serrano', 'Sergio Romero', 'Pablo Ortega', 'Pablo Ruiz', 'Carmen Delgado', 'Marta Gil', 'Íñigo Ezquerra', 'Irene Vázquez'].map((name) => {
    const [givenNames, firstSurname] = name.split(' ');
    return record({ id: name.toLowerCase().normalize('NFD').replace(/\p{M}+/gu, '').replace(' ', '-'), givenNames, firstSurname });
  }),
  record({ id: 'javier-moreno', givenNames: 'Javier', firstSurname: 'Moreno', aliases: ['Javi'] }),
  record({ id: 'jose-ignacio-sanz', givenNames: 'José', firstSurname: 'Ignacio', secondSurname: 'Sanz', aliases: ['Nacho'], nameNeedsReview: true }),
  record({ id: 'luis-perez', givenNames: 'LUIS EDUARDO', firstSurname: 'PÉREZ', secondSurname: 'GÓMEZ', aliases: ['Lucho'] }),
  record({ id: 'baja', givenNames: 'Ramiro', firstSurname: 'Baja', status: 'withdrawn', withdrawnAt: now }),
]);

const strategy = new ContentAssignmentStrategy();

/**
 * @param {any} letter
 * @param {any[]} participants
 */
async function check(letter, participants) {
  const attachments = letter.attachments ? await letter.attachments() : [];
  const body = letter.text?.trim() ? letter.text : letter.html ? htmlToText(letter.html) : letter.text ?? '';
  const from = formatAddress(letter.from);
  const assignment = strategy.assign({ subject: letter.subject, body, from }, participants);
  const metas = attachments.map((a) => createAttachmentMeta({ filename: a.filename, mimeType: a.mimeType, size: a.data.length, contentId: a.contentId }));
  const flags = computeFlags({ subject: letter.subject, body, from, headers: letter.headers ?? {}, attachments: metas, participantIds: assignment.participantIds }).map((f) => f.type);
  assert.equal(assignment.status, letter.expect.status, `${letter.id} ${letter.tests}`);
  if (letter.expect.participants) assert.deepEqual([...assignment.participantIds].sort(), [...letter.expect.participants].sort(), letter.id);
  for (const flag of letter.expect.flags ?? []) assert.ok(flags.includes(flag), `${letter.id}: missing ${flag}`);
  assert.deepEqual(flags.filter((t) => WARNING_FLAG_TYPES.includes(t) && !(letter.expect.flags ?? []).includes(t)), [], `${letter.id}: unexpected warnings`);
}

describe('letters generated for the current participants', () => {
  for (const [label, records] of /** @type {const} */ ([['test participants', seedParticipantRecords({ retreatId: 'r1', now })], ['a mixed real-looking retreat', MIXED]])) {
    it(`builds ~100 varied, unevenly spread letters whose expectations hold (${label})`, async () => {
      const letters = await generateLetters(records);
      const participants = records.filter((r) => r.status === 'active').map(toLettersParticipant);
      assert.ok(letters.length >= 90 && letters.length <= 105, `${letters.length} letters`);
      assert.equal(new Set(letters.map((l) => l.id)).size, letters.length);
      for (const letter of letters) {
        assert.ok(letter.from.address.endsWith(`@${SEED_SENDER_DOMAIN}`), letter.id);
        await check(letter, participants);
      }

      const counts = new Map(participants.map((p) => [p.id, 0]));
      for (const letter of letters) for (const id of letter.expect.participants ?? []) counts.set(id, (counts.get(id) ?? 0) + 1);
      const values = [...counts.values()];
      assert.ok(values.filter((n) => n === 0).length >= 1 && values.filter((n) => n === 0).length <= 3, `participants without letters: ${values.filter((n) => n === 0).length}`);
      assert.ok(Math.max(...values) >= 8, 'someone gets many letters');
      assert.equal(counts.has('baja'), false, 'withdrawn participants get no letters');

      const review = letters.filter((l) => l.expect.status === 'NEEDS_REVIEW');
      assert.ok(review.length >= 6, `${review.length} letters for review`);
      assert.ok(letters.some((l) => (l.expect.participants?.length ?? 0) === 2), 'letters for two participants');
      assert.ok(letters.filter((l) => l.html && /cid:/.test(l.html)).length >= 5, 'illustrated letters');
      for (const kind of ['PDF', 'Word', 'escaneada', 'Texto plano largo']) assert.ok(letters.some((l) => l.tests.includes(kind)), kind);
    });
  }

  it('is deterministic for the same participants and seed', async () => {
    const a = await generateLetters(MIXED);
    const b = await generateLetters(MIXED);
    assert.deepEqual(a.map((l) => [l.id, l.subject, l.from.address]), b.map((l) => [l.id, l.subject, l.from.address]));
  });
});
