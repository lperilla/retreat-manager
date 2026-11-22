import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createParticipant } from '../../src/domain/entities/Participant.js';
import { ContentAssignmentStrategy } from '../../src/domain/services/assignment.js';
import { detectRecipientHints, nameSimilarity, similarParticipants } from '../../src/domain/services/recipientHints.js';

const luis = createParticipant({ displayName: 'Luis Perilla', nameParts: { givenNames: 'Luis', firstSurname: 'Perilla' } });
const luisa = createParticipant({ displayName: 'Luisa Martín' });
const ja = createParticipant({ displayName: 'José Antonio García López', nameParts: { givenNames: 'José Antonio', firstSurname: 'García', secondSurname: 'López' } });
const jm = createParticipant({ displayName: 'José Martínez Ruiz', nameParts: { givenNames: 'José', firstSurname: 'Martínez', secondSurname: 'Ruiz' } });

describe('detectRecipientHints', () => {
  it('reads the name written after the usual triggers, as written', () => {
    assert.deepEqual(detectRecipientHints({ subject: 'Carta para Luis Perila' }), ['Luis Perila']);
    assert.deepEqual(detectRecipientHints({ subject: 'RE: Para: José Garcai' }), ['José Garcai']);
    assert.deepEqual(detectRecipientHints({ subject: 'Hola', body: 'Querido Luis Eduardo:\nTe escribo' }), ['Luis Eduardo']);
    assert.deepEqual(detectRecipientHints({ subject: 'Carta', body: 'Luis Perilla:\nHola' }), ['Luis Perilla']);
    assert.deepEqual(detectRecipientHints({ subject: 'Para mi querido nieto Juan y Ana' }), ['Juan', 'Ana']);
    assert.deepEqual(detectRecipientHints({ subject: 'Carta para José de la Fuente desde casa' }), ['José de la Fuente']);
    assert.deepEqual(detectRecipientHints({ subject: 'Hola a todos' }), []);
    assert.deepEqual(detectRecipientHints({ subject: 'Boletín', body: 'Boletín semanal\n\nHola a todos:\nEsta semana…' }), []);
  });
});

describe('similar names (typos)', () => {
  it('scores close spellings and rules out other names', () => {
    assert.ok(nameSimilarity('Luis Perila', luis) > 0.9);
    assert.equal(nameSimilarity('Pedro Pérez', luis), 0);
    assert.deepEqual(similarParticipants('Jose Martines', [luis, ja, jm]).map((s) => s.participantId), [jm.id]);
    // An exact match hides merely similar names; one word needs a closer spelling.
    assert.deepEqual(similarParticipants('Luis', [luis, luisa]).map((s) => s.participantId), [luis.id]);
  });

  it('turns typos into suggestions only, never assignments', () => {
    const strategy = new ContentAssignmentStrategy();
    const unknown = strategy.assign({ subject: 'Carta para Luis Perila', body: '' }, [luis, luisa]);
    // "Luis" matches the only Luis, but "Perila" contradicts "Perilla" exactly → review with suggestion.
    assert.equal(unknown.status, 'NEEDS_REVIEW');
    assert.equal(unknown.suggestedParticipantIds[0], luis.id);

    const typo = strategy.assign({ subject: 'Carta para José Garcai', body: '' }, [ja, jm]);
    assert.equal(typo.status, 'NEEDS_REVIEW');
    assert.equal(typo.suggestedParticipantIds[0], ja.id, 'the similar surname ranks José Antonio first');
    assert.ok(typo.matches.some((m) => m.signal === 'NAME_SIMILAR' && m.participantId === ja.id) || typo.suggestedParticipantIds.includes(ja.id));
  });
});
