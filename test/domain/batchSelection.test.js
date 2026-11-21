import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { markPending, markPrinted } from '../../src/domain/entities/PrintStatus.js';
import {
  buildBatchExportPayload,
  resolveSelection,
  selectAllParticipants,
  selectParticipantsPendingPrint,
  selectParticipantsWithLetters,
} from '../../src/domain/services/batchSelection.js';
import { computeParticipantStats } from '../../src/domain/services/counting.js';
import { PARTICIPANTS, assignedTo, makeLetter } from '../helpers/domainFixtures.js';

const ALPHABETICAL = ['ana-martin', 'juan-perez', 'lucia-fernandez', 'maria-garcia', 'maria-lopez', 'pedro-sanchez'];

describe('batch selection helpers', () => {
  it('selects all participants alphabetically', () => {
    assert.deepEqual(selectAllParticipants(PARTICIPANTS), ALPHABETICAL);
  });

  it('selects participants with at least one letter (Map, object or stats array)', () => {
    const letters = [
      makeLetter({ assignment: assignedTo(['pedro-sanchez']) }),
      makeLetter({ assignment: assignedTo(['ana-martin', 'juan-perez']) }),
    ];
    const stats = computeParticipantStats(PARTICIPANTS, letters);
    assert.deepEqual(selectParticipantsWithLetters(PARTICIPANTS, stats), ['ana-martin', 'juan-perez', 'pedro-sanchez']);
    assert.deepEqual(selectParticipantsWithLetters(PARTICIPANTS, { 'maria-lopez': 2, 'ana-martin': 0 }), ['maria-lopez']);
    assert.deepEqual(selectParticipantsWithLetters(PARTICIPANTS, new Map([['juan-perez', 1]])), ['juan-perez']);
  });

  it('selects participants pending print (no status counts as pending)', () => {
    const now = new Date('2025-11-04T10:00:00Z');
    const statuses = [markPrinted('ana-martin', now), markPrinted('juan-perez', now), markPending('pedro-sanchez')];
    assert.deepEqual(selectParticipantsPendingPrint(PARTICIPANTS, statuses), [
      'lucia-fernandez',
      'maria-garcia',
      'maria-lopez',
      'pedro-sanchez',
    ]);
  });
});

describe('resolveSelection', () => {
  it('deduplicates and sorts alphabetically', () => {
    assert.deepEqual(resolveSelection(['pedro-sanchez', 'ana-martin', 'pedro-sanchez'], PARTICIPANTS), ['ana-martin', 'pedro-sanchez']);
  });

  it('rejects an empty selection', () => {
    assert.throws(() => resolveSelection([], PARTICIPANTS), { code: 'EMPTY_SELECTION', httpStatus: 400 });
  });

  it('rejects unknown participants with PARTICIPANT_NOT_FOUND', () => {
    assert.throws(() => resolveSelection(['ghost'], PARTICIPANTS), (error) => {
      assert.equal(error.code, 'PARTICIPANT_NOT_FOUND');
      assert.equal(error.httpStatus, 404);
      assert.deepEqual(error.toJSON(), { code: 'PARTICIPANT_NOT_FOUND', message: 'Participante no encontrado.' });
      return true;
    });
  });
});

describe('buildBatchExportPayload', () => {
  it('builds one alphabetical section per participant with chronological letters', () => {
    const shared = makeLetter({ messageId: 'shared', receivedAt: '2025-11-03T09:00:00Z', assignment: assignedTo(['juan-perez', 'ana-martin']) });
    const late = makeLetter({ messageId: 'late', receivedAt: '2025-11-05T09:00:00Z', assignment: assignedTo(['juan-perez']) });
    const early = makeLetter({ messageId: 'early', receivedAt: '2025-11-02T09:00:00Z', assignment: assignedTo(['juan-perez']) });
    const gone = makeLetter({ messageId: 'gone', assignment: assignedTo(['juan-perez']), deletedAt: '2025-11-06T00:00:00Z' });

    const payload = buildBatchExportPayload({
      participants: PARTICIPANTS,
      letters: [late, shared, early, gone],
      participantIds: ['juan-perez', 'ana-martin', 'pedro-sanchez'],
      generatedAt: new Date('2025-11-06T10:00:00Z'),
      timeZone: 'Europe/Madrid',
    });

    assert.deepEqual(payload.sections.map((s) => s.participant.id), ['ana-martin', 'juan-perez', 'pedro-sanchez']);
    assert.deepEqual(payload.sections[1].letters.map((l) => l.messageId), ['early', 'shared', 'late']);
    assert.equal(payload.sections[2].letterCount, 0);
    assert.equal(payload.participantCount, 3);
    assert.equal(payload.letterCount, 4);
    assert.equal(payload.uniqueLetterCount, 3);
    assert.equal(payload.timeZone, 'Europe/Madrid');
  });
});
