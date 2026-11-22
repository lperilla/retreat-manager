import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createParticipant } from '../../src/domain/entities/Participant.js';
import { ContentAssignmentStrategy } from '../../src/domain/services/assignment.js';
import { nameVariants } from '../../src/domain/services/nameVariants.js';
import { ageOn, createParticipantRecord, identityDocument, missingFields, splitFullName } from '../../src/modules/participants/domain/ParticipantRecord.js';
import { createRetreat, deletionDate, hasEnded, isDeletionDue } from '../../src/modules/participants/domain/Retreat.js';

const BASE = Object.freeze({ id: 'jose-garcia', retreatId: 'r1', givenNames: 'José', firstSurname: 'García', createdAt: '2026-11-21T10:00:00Z' });

describe('splitFullName (names stored by older versions)', () => {
  it('splits two words safely and flags longer names for review, keeping surname particles together', () => {
    assert.deepEqual(splitFullName('Juan  Pérez'), { givenNames: 'Juan', firstSurname: 'Pérez', secondSurname: null, needsReview: false });
    assert.deepEqual(splitFullName('José Ignacio Sanz'), { givenNames: 'José', firstSurname: 'Ignacio', secondSurname: 'Sanz', needsReview: true });
    assert.deepEqual(splitFullName('José Antonio García López'), { givenNames: 'José Antonio', firstSurname: 'García', secondSurname: 'López', needsReview: true });
    assert.deepEqual(splitFullName('María de la Fuente'), { givenNames: 'María', firstSurname: 'de la Fuente', secondSurname: null, needsReview: false });
    assert.equal(splitFullName('Íñigo').needsReview, true);
  });
});

describe('createParticipantRecord', () => {
  it('builds the display name, cleans aliases and reports what a complete profile still needs', () => {
    const record = createParticipantRecord({ ...BASE, secondSurname: 'López', aliases: ['Pepe', 'pepe', 'José García López', ' '] });
    assert.equal(record.displayName, 'José García López');
    assert.deepEqual(record.aliases, ['Pepe']);
    assert.deepEqual(missingFields(record), ['age', 'emergencyContact']);
    const complete = createParticipantRecord({ ...BASE, birthDate: '1990-12-01', emergencyContacts: [{ name: 'Ana', phone: '+34 600 123 456' }] });
    assert.deepEqual(missingFields(complete), []);
    assert.equal(ageOn(complete, '2026-11-30'), 35);
    assert.equal(ageOn(complete, '2026-12-01'), 36);
  });

  it('validates contact data and catalog entries, and keeps only practical information', () => {
    const invalid = (/** @type {Record<string, unknown>} */ extra) => () => createParticipantRecord({ ...BASE, ...extra });
    assert.throws(invalid({ phone: 'abc' }), /Teléfono/);
    assert.throws(invalid({ emergencyContacts: [{ name: 'Ana' }] }), /falta el teléfono/);
    assert.throws(invalid({ emergencyContacts: [{ name: 'A', phone: '600111222' }, { name: 'B', phone: '600111223' }, { name: 'C', phone: '600111224' }] }), /como máximo dos/);
    assert.throws(invalid({ age: 150 }), /Edad/);
    assert.throws(invalid({ nationality: 'x'.repeat(61) }), /Nacionalidad/);
    assert.equal(createParticipantRecord({ ...BASE, nationality: '  Colombia ' }).nationality, 'Colombia');
    assert.equal(createParticipantRecord({ ...BASE, nationality: '' }).nationality, null);
    assert.equal(createParticipantRecord(BASE).nationality, null);
    assert.throws(invalid({ dietary: [{ type: 'allergy', code: 'other' }] }), /indica cuál/);
    assert.throws(invalid({ accessibilityNeeds: [{ code: 'diagnosis' }] }), /opción desconocida/);
    const record = createParticipantRecord({
      ...BASE,
      dietary: [
        { type: 'allergy', code: 'nuts', severity: 'severe' },
        { type: 'allergy', code: 'nuts', severity: 'mild' },
        { type: 'diet', code: 'vegetarian', severity: 'severe' },
      ],
    });
    assert.deepEqual(record.dietary, [
      { type: 'allergy', code: 'nuts', severity: 'severe', detail: null },
      { type: 'diet', code: 'vegetarian', severity: null, detail: null },
    ]);
  });
});

describe('identity documents', () => {
  it('normalizes and checks DNI and NIE control letters, and accepts passports and other documents from any country', () => {
    assert.deepEqual(identityDocument({ type: 'dni', number: '12345678-z' }), { type: 'dni', number: '12345678Z', country: 'España', otherType: null });
    assert.deepEqual(identityDocument({ type: 'nie', number: 'x 1234567 l' }), { type: 'nie', number: 'X1234567L', country: 'España', otherType: null });
    assert.deepEqual(identityDocument({ type: 'passport', number: 'ab123456', country: 'Colombia' }), { type: 'passport', number: 'AB123456', country: 'Colombia', otherType: null });
    assert.deepEqual(identityDocument({ type: 'other', number: '1020304050', otherType: 'Cédula', country: 'Colombia' }), { type: 'other', number: '1020304050', country: 'Colombia', otherType: 'Cédula' });
    assert.equal(identityDocument({ type: '', number: '' }), null);
    assert.throws(() => identityDocument({ type: 'dni', number: '12345678A' }), /letra del DNI/);
    assert.throws(() => identityDocument({ type: 'nie', number: 'X1234567A' }), /letra del NIE/);
    assert.throws(() => identityDocument({ type: 'dni', number: '1234' }), /8 números/);
    assert.throws(() => identityDocument({ type: 'other', number: '123' }), /qué documento/);
    assert.throws(() => identityDocument({ type: '', number: '123' }), /tipo de documento/);
    assert.throws(() => identityDocument({ type: 'passport', number: 'A$' }), /letras y números/);
  });
});

describe('Retreat deletion schedule', () => {
  const retreat = createRetreat({ id: 'r1', name: 'Retiro', startDate: '2026-11-20', endDate: '2026-11-22', createdAt: '2026-11-01T00:00:00Z' });
  const options = { retentionDays: 30, timeZone: 'Europe/Madrid' };

  it('deletes at local midnight after the last day plus the retention days', () => {
    assert.equal(deletionDate(retreat, options)?.toISOString(), '2026-12-22T23:00:00.000Z');
    assert.equal(isDeletionDue(retreat, new Date('2026-12-22T22:59:59Z'), options), false);
    assert.equal(isDeletionDue(retreat, new Date('2026-12-22T23:00:00Z'), options), true);
    assert.equal(hasEnded(retreat, new Date('2026-11-22T22:59:00Z'), 'Europe/Madrid'), false);
    assert.equal(hasEnded(retreat, new Date('2026-11-22T23:00:00Z'), 'Europe/Madrid'), true);
    assert.equal(deletionDate({ endDate: null }, options), null);
  });

  it('validates dates', () => {
    assert.throws(() => createRetreat({ id: 'r', createdAt: new Date(), startDate: '2026-11-22', endDate: '2026-11-20' }), { code: 'INVALID_RETREAT' });
    assert.throws(() => createRetreat({ id: 'r', createdAt: new Date(), endDate: '22/11/2026' }), { code: 'INVALID_RETREAT' });
  });
});

describe('name variants and surname contradiction (letter matching)', () => {
  const ja = createParticipant({
    displayName: 'José Antonio García López',
    nameParts: { givenNames: 'José Antonio', firstSurname: 'García', secondSurname: 'López' },
  });
  const jm = createParticipant({ displayName: 'José Martínez Ruiz', nameParts: { givenNames: 'José', firstSurname: 'Martínez', secondSurname: 'Ruiz' } });
  const strategy = new ContentAssignmentStrategy();
  const assign = (/** @type {string} */ subject, list = [ja, jm]) => strategy.assign({ subject, body: '', from: 'x' }, list);

  it('generates variants with one or both surnames, every given name and initials', () => {
    const variants = nameVariants(ja.nameParts);
    for (const expected of ['jose garcia', 'jose antonio garcia', 'jose a garcia', 'jose a. garcia', 'jose garcia lopez', 'jose antonio garcia lopez']) {
      assert.ok(variants.includes(expected), expected);
    }
    assert.deepEqual(nameVariants(createParticipant({ displayName: 'Ana García-Pérez', nameParts: { givenNames: 'Ana', firstSurname: 'García-Pérez' } }).nameParts).sort(), [
      'ana garcia pérez'.normalize('NFD').replace(/\p{M}/gu, ''),
      'ana garcia-perez',
    ].sort());
  });

  it('assigns partial names reliably even when another participant shares the first name', () => {
    for (const subject of ['Carta para José García', 'Carta para Jose Antonio Garcia', 'Carta para José A. García', 'Carta para Jose Garcia Lopez']) {
      assert.deepEqual(assign(subject).participantIds, [ja.id], subject);
    }
  });

  it('sends a letter to review when the surname contradicts the only candidate, or two people share the variant', () => {
    const contradicted = assign('Carta para José Pérez', [ja]);
    assert.equal(contradicted.status, 'NEEDS_REVIEW');
    assert.deepEqual(contradicted.suggestedParticipantIds, [ja.id]);
    // Continuation words are not surnames.
    assert.equal(assign('Carta para José De parte de mamá', [ja]).status, 'ASSIGNED');
    const twin = createParticipant({ displayName: 'José García Pérez', nameParts: { givenNames: 'José', firstSurname: 'García', secondSurname: 'Pérez' } });
    const shared = assign('Carta para José García', [ja, twin]);
    assert.equal(shared.status, 'NEEDS_REVIEW');
    assert.deepEqual([...shared.suggestedParticipantIds].sort(), [ja.id, twin.id].sort());
  });
});
