import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AssignmentStatus, FlagType, SignalType } from '../../src/domain/constants.js';
import { createAssignmentOverride } from '../../src/domain/entities/AssignmentOverride.js';
import { createParticipant } from '../../src/domain/entities/Participant.js';
import {
  ContentAssignmentStrategy,
  applyAssignmentOverride,
  buildParticipantIndex,
  decideAssignment,
} from '../../src/domain/services/assignment.js';
import { summarizeRetreat } from '../../src/domain/services/counting.js';
import { computeFlags } from '../../src/domain/services/heuristics.js';
import { syncDiff } from '../../src/domain/services/syncDiff.js';
import { PARTICIPANTS, makeLetter } from '../helpers/domainFixtures.js';

const strategy = new ContentAssignmentStrategy();
const assign = (input) => strategy.assign(input, PARTICIPANTS);
const signalFor = (assignment, participantId) => assignment.matches.find((m) => m.participantId === participantId);
const mentions = (assignment, participantId) =>
  assignment.participantIds.includes(participantId) ||
  assignment.suggestedParticipantIds.includes(participantId) ||
  assignment.matches.some((m) => m.participantId === participantId);

/** @param {string} participantId @param {string} signal @param {number} confidence */
const sig = (participantId, signal, confidence, ambiguous = false) => ({
  participantId,
  signal,
  confidence,
  matchedText: participantId,
  ambiguous,
  groupId: ambiguous ? 'g1' : null,
});

describe('participant index', () => {
  it('marks a first name shared by two participants as ambiguous', () => {
    const index = buildParticipantIndex(PARTICIPANTS);
    const maria = index.entries.find((e) => e.key === 'maria');
    assert.ok(maria);
    assert.equal(maria.ambiguous, true);
    assert.deepEqual(maria.participantIds, ['maria-garcia', 'maria-lopez']);
    const juan = index.entries.find((e) => e.key === 'juan');
    assert.equal(juan?.ambiguous, false);
  });
});

describe('SUBJECT_EXPLICIT', () => {
  it('assigns "Carta para María García" with confidence 0.95 and the original matched text', () => {
    const result = assign({ subject: 'Carta para María García', body: 'Te echamos mucho de menos.\nUn abrazo,\nTu madre' });
    assert.equal(result.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(result.participantIds, ['maria-garcia']);
    assert.equal(result.signal, SignalType.SUBJECT_EXPLICIT);
    assert.equal(result.confidence, 0.95);
    assert.equal(result.matchedText, 'Carta para María García');
  });

  it('supports "[Para: X]", "Para: X" and reply prefixes', () => {
    assert.deepEqual(assign({ subject: '[Para: Pedro Sánchez] Ánimo', body: 'Mucha fuerza.' }).participantIds, ['pedro-sanchez']);
    assert.deepEqual(assign({ subject: 'Para: Lucía Fernández', body: 'Mucha fuerza.' }).participantIds, ['lucia-fernandez']);
    assert.deepEqual(assign({ subject: 'RE: Fwd: carta para Ana', body: 'Mucha fuerza.' }).participantIds, ['ana-martin']);
  });

  it('ignores "para" not followed by a participant name', () => {
    const result = assign({ subject: 'Un regalo para todos', body: 'Mucha fuerza a todo el grupo, os pensamos.' });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds, []);
  });
});

describe('BODY_EXPLICIT', () => {
  it('assigns a body-only "Querido Juan:" letter', () => {
    const result = assign({ subject: 'Ánimo', body: 'Querido Juan:\nEstamos muy orgullosos de ti.\nUn beso enorme,\nMamá' });
    assert.equal(result.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(result.participantIds, ['juan-perez']);
    assert.equal(result.signal, SignalType.BODY_EXPLICIT);
    assert.equal(result.confidence, 0.85);
    assert.equal(result.matchedText, 'Querido Juan:');
  });

  it('recognises the supported salutations', () => {
    const cases = [
      ['Hola Pedro, ¿cómo va todo?', 'pedro-sanchez'],
      ['Hola querida Lucía, te escribo desde casa.', 'lucia-fernandez'],
      ['Mi querida Ana, qué ganas de verte.', 'ana-martin'],
      ['Carta para Pedro Sánchez\nTe pensamos.', 'pedro-sanchez'],
      ['Para: Lucía Fernández\nTe pensamos.', 'lucia-fernandez'],
      ['Buenos días Pedro,\nAquí todo bien.', 'pedro-sanchez'],
      ['Juan:\nTe escribo con mucho cariño.', 'juan-perez'],
      ['Mi querido nieto Juan, estamos contigo.', 'juan-perez'],
    ];
    for (const [body, expected] of cases) {
      const result = assign({ subject: 'Ánimo', body });
      assert.deepEqual(result.participantIds, [expected], `body: ${body}`);
      assert.equal(result.signal, SignalType.BODY_EXPLICIT, `body: ${body}`);
    }
  });

  it('only counts salutations inside the scan window', () => {
    const filler = 'Te escribo desde casa. '.repeat(30);
    const outside = assign({ subject: 'Ánimo', body: `${filler}\nQuerido Juan:\nÁnimo.` });
    assert.equal(outside.status, AssignmentStatus.NEEDS_REVIEW);
    assert.equal(signalFor(outside, 'juan-perez'), undefined);

    const inside = assign({ subject: 'Ánimo', body: `${'Te escribo desde casa. '.repeat(10)}\nQuerido Juan:\nÁnimo.` });
    assert.equal(inside.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(inside.participantIds, ['juan-perez']);
  });

  it('honours a custom BODY_SCAN_CHARS', () => {
    const narrow = new ContentAssignmentStrategy({ bodyScanChars: 10 });
    const result = narrow.assign({ subject: 'Ánimo', body: 'Te escribimos hoy.\nQuerido Juan:\nÁnimo.' }, PARTICIPANTS);
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
  });
});

describe('ambiguity', () => {
  it('sends a bare shared first name to review with both candidates suggested', () => {
    const result = assign({ subject: 'Ánimo', body: 'Querida María:\nTe mandamos mucha fuerza.' });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.participantIds, []);
    assert.deepEqual(result.suggestedParticipantIds, ['maria-garcia', 'maria-lopez']);
  });

  it('is not treated as multi-recipient', () => {
    const result = assign({ subject: 'Ánimo', body: 'Querida María:\nTe mandamos mucha fuerza.' });
    assert.notEqual(result.status, AssignmentStatus.ASSIGNED);
  });

  it('is resolved when the subject names one of the candidates explicitly', () => {
    const result = assign({ subject: 'Carta para María García', body: 'Querida María:\nTe mandamos mucha fuerza.' });
    assert.equal(result.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(result.participantIds, ['maria-garcia']);
  });

  it('ranks the candidate mentioned by full name first but still requires review', () => {
    const result = assign({
      subject: 'Ánimo',
      body: 'Querida María:\nTe mandamos mucha fuerza.\nSabemos que María López está en tu grupo y te ayudará.',
    });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds.slice(0, 2), ['maria-lopez', 'maria-garcia']);
  });
});

describe('sender and signature are never recipient signals', () => {
  it('does not assign to a participant whose name is the sender name', () => {
    const result = assign({
      subject: 'Ánimo',
      from: '"Lucía Fernández" <lucia.fernandez@example.com>',
      body: 'Querido Juan:\nÁnimo, campeón.\nLucía Fernández',
    });
    assert.deepEqual(result.participantIds, ['juan-perez']);
    assert.equal(mentions(result, 'lucia-fernandez'), false);
  });

  it('ignores a signature after a closing phrase', () => {
    const result = assign({
      subject: 'Ánimo',
      from: 'Familia <familia@example.com>',
      body: 'Querido Pedro:\nTe queremos mucho.\nUn abrazo muy fuerte,\nAna Martín',
    });
    assert.deepEqual(result.participantIds, ['pedro-sanchez']);
    assert.equal(mentions(result, 'ana-martin'), false);
  });

  it('ignores an RFC signature block', () => {
    const result = assign({
      subject: 'Ánimo',
      body: 'Querido Pedro:\nAquí seguimos.\n-- \nAna Martín\nTeléfono 600 000 000',
    });
    assert.deepEqual(result.participantIds, ['pedro-sanchez']);
    assert.equal(mentions(result, 'ana-martin'), false);
  });

  it('leaves a letter whose only name is the sender in review without suggestions', () => {
    const result = assign({
      subject: 'Ánimo',
      from: '"Lucía Fernández" <lucia@example.com>',
      body: 'Mucha fuerza en estos días.\n\nLucía Fernández',
    });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds, []);
  });
});

describe('quoted text', () => {
  it('ignores participants mentioned only in a quoted reply', () => {
    const result = assign({
      subject: 'Re: Cartas',
      body: [
        'Querido Pedro:',
        'Aquí seguimos rezando por ti.',
        '',
        'El lun, 3 nov 2025 a las 10:15, Coordinación <retiro@example.com> escribió:',
        '> Recordad que la carta para Ana Martín también es bienvenida.',
        '> Un saludo',
      ].join('\n'),
    });
    assert.deepEqual(result.participantIds, ['pedro-sanchez']);
    assert.equal(mentions(result, 'ana-martin'), false);
  });

  it('ignores ">" lines anywhere', () => {
    const result = assign({ subject: 'Ánimo', body: '> Querida Lucía:\nQuerido Pedro:\nÁnimo.' });
    assert.deepEqual(result.participantIds, ['pedro-sanchez']);
  });

  it('keeps the content of a forwarded letter but drops its headers', () => {
    const result = assign({
      subject: 'Fwd: carta de la abuela',
      body: [
        'Te reenvío la carta de la abuela.',
        '',
        '---------- Forwarded message ---------',
        'De: Abuela Carmen <carmen@example.com>',
        'Date: lun, 3 nov 2025, 9:00',
        'Subject: Para Lucía',
        'To: familia@example.com',
        '',
        'Querida Lucía:',
        'Estoy muy orgullosa de ti.',
      ].join('\n'),
    });
    assert.deepEqual(result.participantIds, ['lucia-fernandez']);
  });
});

describe('normalization', () => {
  it('is accent and case insensitive', () => {
    assert.deepEqual(assign({ subject: 'CARTA PARA JUAN PEREZ', body: 'Ánimo.' }).participantIds, ['juan-perez']);
    assert.deepEqual(assign({ subject: 'carta para lucia fernandez', body: 'Ánimo.' }).participantIds, ['lucia-fernandez']);
  });

  it('matches aliases', () => {
    assert.deepEqual(assign({ subject: 'Ánimo', body: 'Querida Mari:\nTe pensamos.' }).participantIds, ['maria-garcia']);
    assert.deepEqual(assign({ subject: 'Ánimo', body: 'hola juanito, ¿cómo va todo?' }).participantIds, ['juan-perez']);
  });

  it('does not match a name inside a longer word', () => {
    const result = assign({ subject: 'Ánimo', body: 'Hola Anabel, saludos.' });
    assert.equal(mentions(result, 'ana-martin'), false);
  });

  it('a full-name mention alone is a low-confidence suggestion', () => {
    const result = assign({ subject: 'Ánimo', body: 'Rezamos cada noche por Pedro Sánchez y por su familia.' });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds, ['pedro-sanchez']);
    assert.equal(signalFor(result, 'pedro-sanchez')?.signal, SignalType.NAME_MENTION);
    assert.equal(signalFor(result, 'pedro-sanchez')?.confidence, 0.3);
  });
});

describe('threshold and margin', () => {
  it('requires the top score to reach ASSIGNMENT_MIN_CONFIDENCE', () => {
    const result = decideAssignment([sig('a', SignalType.BODY_EXPLICIT, 0.85)], { minConfidence: 0.9 });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds, ['a']);
  });

  it('does not auto-assign when another candidate is within 0.15', () => {
    const result = decideAssignment([sig('a', SignalType.NAME_MENTION, 0.9), sig('b', SignalType.NAME_MENTION, 0.76)], {
      minConfidence: 0.75,
    });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds, ['a', 'b']);
  });

  it('auto-assigns when the gap is exactly 0.15 (floating point safe)', () => {
    const result = decideAssignment([sig('a', SignalType.NAME_MENTION, 0.95), sig('b', SignalType.NAME_MENTION, 0.8)], {
      minConfidence: 0.75,
    });
    assert.equal(result.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(result.participantIds, ['a']);
  });

  it('never auto-assigns an ambiguous top candidate', () => {
    const result = decideAssignment([sig('a', SignalType.BODY_EXPLICIT, 0.85, true)]);
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
  });

  it('with a stricter strategy only subject signals auto-assign', () => {
    const strict = new ContentAssignmentStrategy({ minConfidence: 0.9 });
    assert.equal(strict.assign({ subject: 'Ánimo', body: 'Querido Juan:\nÁnimo.' }, PARTICIPANTS).status, AssignmentStatus.NEEDS_REVIEW);
    assert.equal(strict.assign({ subject: 'Carta para Juan', body: 'Ánimo.' }, PARTICIPANTS).status, AssignmentStatus.ASSIGNED);
  });

  it('returns NEEDS_REVIEW with no suggestions when nothing matches', () => {
    const result = decideAssignment([]);
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(result.suggestedParticipantIds, []);
    assert.equal(result.signal, null);
  });

  it('rejects invalid options', () => {
    assert.throws(() => new ContentAssignmentStrategy({ minConfidence: 2 }), { code: 'VALIDATION_ERROR' });
    assert.throws(() => new ContentAssignmentStrategy({ bodyScanChars: -1 }), { code: 'VALIDATION_ERROR' });
  });
});

describe('manual overrides', () => {
  const input = { subject: 'Ánimo', body: 'Querido Juan:\nÁnimo.' };

  it('always win over heuristics', () => {
    const override = createAssignmentOverride({ messageId: 'm1', participantIds: ['ana-martin'] });
    const result = strategy.assign(input, PARTICIPANTS, { override });
    assert.equal(result.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(result.participantIds, ['ana-martin']);
    assert.equal(result.signal, SignalType.MANUAL);
    assert.equal(result.confidence, 1);
  });

  it('survive a re-sync (recomputing the same message keeps the override)', () => {
    const override = createAssignmentOverride({ messageId: 'm1', participantIds: ['ana-martin'] });
    const firstSync = strategy.assign(input, PARTICIPANTS, { override });
    const secondSync = strategy.assign({ ...input, body: `${input.body}\n` }, PARTICIPANTS, { override });
    assert.deepEqual(firstSync.participantIds, ['ana-martin']);
    assert.deepEqual(secondSync.participantIds, ['ana-martin']);
  });

  it('an empty override leaves the letter explicitly unassigned', () => {
    const computed = assign(input);
    const result = applyAssignmentOverride(computed, { participantIds: [] });
    assert.equal(result.status, AssignmentStatus.UNASSIGNED);
    assert.deepEqual(result.participantIds, []);
  });

  it('without override the computed assignment is returned', () => {
    const computed = assign(input);
    assert.equal(applyAssignmentOverride(computed, null), computed);
  });
});

describe('multi-recipient', () => {
  it('assigns every participant named explicitly', () => {
    const result = assign({ subject: 'Carta para Juan y Lucía', body: 'Os queremos mucho.' });
    assert.equal(result.status, AssignmentStatus.ASSIGNED);
    assert.deepEqual(result.participantIds, ['juan-perez', 'lucia-fernandez']);
    assert.equal(result.matches.length, 2);
  });

  it('combines subject and body explicit signals', () => {
    const result = assign({ subject: 'Carta para Pedro', body: 'Querida Ana:\nTambién hay unas líneas para ti.' });
    assert.deepEqual(result.participantIds, ['pedro-sanchez', 'ana-martin']);
  });

  it('goes to review when one of the explicit names is ambiguous', () => {
    const result = assign({ subject: 'Ánimo', body: 'Queridos Juan y María:\nOs pensamos.' });
    assert.equal(result.status, AssignmentStatus.NEEDS_REVIEW);
  });

  it('is flagged MULTI_RECIPIENT and counts once per participant, deduplicated by messageId', () => {
    const assignment = assign({ subject: 'Carta para Juan y Lucía', body: 'Os queremos mucho.' });
    const flags = computeFlags({ subject: 'Carta para Juan y Lucía', body: 'Os queremos mucho.', participantIds: assignment.participantIds });
    assert.ok(flags.some((f) => f.type === FlagType.MULTI_RECIPIENT));

    const letter = makeLetter({ messageId: 'multi-1', assignment, flags });
    const summary = summarizeRetreat({ participants: PARTICIPANTS, letters: [letter, letter] });
    assert.equal(summary.totalLetters, 1);
    const count = (id) => summary.perParticipant.find((s) => s.participantId === id)?.letterCount;
    assert.equal(count('juan-perez'), 1);
    assert.equal(count('lucia-fernandez'), 1);

    const diff = syncDiff({ known: [], incoming: [letter, letter] });
    assert.equal(diff.added.length, 1);
  });
});

describe('participants change', () => {
  it('caches the index per participants array and rebuilds for a new array', () => {
    const renamed = [...PARTICIPANTS, createParticipant({ id: 'carmen-ruiz', displayName: 'Carmen Ruiz' })];
    const input = { subject: 'Carta para Carmen', body: 'Ánimo.' };
    assert.equal(strategy.assign(input, PARTICIPANTS).status, AssignmentStatus.NEEDS_REVIEW);
    assert.deepEqual(strategy.assign(input, renamed).participantIds, ['carmen-ruiz']);
  });

  it('returns no signals when there are no participants', () => {
    assert.deepEqual(strategy.extractSignals({ subject: 'Carta para Juan' }, []), []);
  });
});
