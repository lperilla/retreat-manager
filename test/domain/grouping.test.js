import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  groupLettersByLocalDay,
  groupLettersByParticipant,
  groupParticipantLetters,
} from '../../src/domain/services/grouping.js';
import { parseAfterDate, toZonedDateKey, zonedWallClockToInstant } from '../../src/domain/services/time.js';
import { assignedTo, makeLetter, needsReview } from '../helpers/domainFixtures.js';

const MADRID = 'Europe/Madrid';
const juan = (messageId, receivedAt, extra = {}) =>
  makeLetter({ messageId, receivedAt, assignment: assignedTo(['juan-perez']), ...extra });
const ids = (letters) => letters.map((l) => l.messageId);

describe('groupParticipantLetters', () => {
  it('returns letters in ascending receivedAt order', () => {
    const letters = [
      juan('c', '2025-11-05T09:00:00Z'),
      juan('a', '2025-11-03T09:00:00Z'),
      juan('b', '2025-11-04T09:00:00Z'),
    ];
    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez')), ['a', 'b', 'c']);
  });

  it('breaks ties on receivedAt by messageId (stable)', () => {
    const letters = [juan('m-2', '2025-11-03T09:00:00Z'), juan('m-1', '2025-11-03T09:00:00Z'), juan('m-3', '2025-11-03T09:00:00Z')];
    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez')), ['m-1', 'm-2', 'm-3']);
    assert.deepEqual(ids(groupParticipantLetters([...letters].reverse(), 'juan-perez')), ['m-1', 'm-2', 'm-3']);
  });

  it('includes only active letters assigned to the participant', () => {
    const letters = [
      juan('mine', '2025-11-03T09:00:00Z'),
      juan('deleted', '2025-11-03T10:00:00Z', { deletedAt: '2025-11-04T00:00:00Z' }),
      makeLetter({ messageId: 'review', assignment: needsReview(['juan-perez']) }),
      makeLetter({ messageId: 'other', assignment: assignedTo(['ana-martin']) }),
      makeLetter({ messageId: 'shared', receivedAt: '2025-11-03T11:00:00Z', assignment: assignedTo(['ana-martin', 'juan-perez']) }),
    ];
    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez')), ['mine', 'shared']);
  });

  it('treats a date-only afterDate as exclusive (strictly after that local day)', () => {
    const letters = [
      juan('day-2', '2025-11-02T12:00:00Z'),
      juan('day-3', '2025-11-03T12:00:00Z'),
      juan('day-4', '2025-11-04T12:00:00Z'),
    ];
    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez', { afterDate: '2025-11-03', timeZone: MADRID })), ['day-4']);
  });

  it('evaluates the midnight boundary in the configured time zone', () => {
    // Madrid is UTC+1 in November.
    const beforeMidnight = juan('before', '2025-11-03T22:59:00Z'); // 23:59 on Nov 3 in Madrid
    const afterMidnight = juan('after', '2025-11-03T23:30:00Z'); // 00:30 on Nov 4 in Madrid
    const letters = [beforeMidnight, afterMidnight];

    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez', { afterDate: '2025-11-03', timeZone: MADRID })), ['after']);
    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez', { afterDate: '2025-11-03', timeZone: 'UTC' })), []);
  });

  it('treats an instant afterDate as exclusive', () => {
    const letters = [juan('exact', '2025-11-03T10:00:00Z'), juan('later', '2025-11-03T10:00:01Z')];
    assert.deepEqual(
      ids(groupParticipantLetters(letters, 'juan-perez', { afterDate: '2025-11-03T10:00:00Z', timeZone: MADRID })),
      ['later'],
    );
    assert.deepEqual(
      ids(groupParticipantLetters(letters, 'juan-perez', { afterDate: new Date('2025-11-03T10:00:00Z'), timeZone: MADRID })),
      ['later'],
    );
  });

  it('interprets a local date-time afterDate as wall-clock time in the configured zone', () => {
    // 2025-11-04T00:00 in Madrid = 2025-11-03T23:00Z
    const letters = [juan('at', '2025-11-03T23:00:00Z'), juan('after', '2025-11-03T23:30:00Z')];
    assert.deepEqual(ids(groupParticipantLetters(letters, 'juan-perez', { afterDate: '2025-11-04T00:00', timeZone: MADRID })), ['after']);
  });

  it('rejects invalid dates and time zones', () => {
    assert.throws(() => groupParticipantLetters([], 'juan-perez', { afterDate: '2025-02-30' }), { code: 'INVALID_DATE' });
    assert.throws(() => groupParticipantLetters([], 'juan-perez', { afterDate: 'ayer' }), { code: 'INVALID_DATE' });
    assert.throws(() => groupParticipantLetters([], 'juan-perez', { timeZone: 'Mars/Olympus' }), { code: 'INVALID_TIMEZONE' });
  });
});

describe('groupLettersByParticipant and groupLettersByLocalDay', () => {
  it('lists a multi-recipient letter under each participant', () => {
    const shared = makeLetter({ messageId: 'shared', assignment: assignedTo(['ana-martin', 'juan-perez']) });
    const groups = groupLettersByParticipant([shared], ['juan-perez', 'ana-martin', 'pedro-sanchez']);
    assert.deepEqual(ids(groups.get('juan-perez') ?? []), ['shared']);
    assert.deepEqual(ids(groups.get('ana-martin') ?? []), ['shared']);
    assert.deepEqual(groups.get('pedro-sanchez'), []);
  });

  it('splits by local calendar day across midnight', () => {
    const days = groupLettersByLocalDay(
      [juan('late', '2025-11-03T22:59:00Z'), juan('early', '2025-11-03T23:30:00Z'), juan('noon', '2025-11-04T11:00:00Z')],
      MADRID,
    );
    assert.deepEqual(
      days.map((d) => [d.dateKey, ids(d.letters)]),
      [
        ['2025-11-03', ['late']],
        ['2025-11-04', ['early', 'noon']],
      ],
    );
  });
});

describe('time helpers', () => {
  it('computes local date keys and wall-clock instants, including DST', () => {
    assert.equal(toZonedDateKey(new Date('2025-11-03T23:30:00Z'), MADRID), '2025-11-04');
    assert.equal(zonedWallClockToInstant({ year: 2025, month: 7, day: 1 }, MADRID).toISOString(), '2025-06-30T22:00:00.000Z');
    assert.equal(zonedWallClockToInstant({ year: 2025, month: 1, day: 15, hour: 9 }, MADRID).toISOString(), '2025-01-15T08:00:00.000Z');
  });

  it('parseAfterDate returns null for empty values', () => {
    assert.equal(parseAfterDate(null, MADRID), null);
    assert.equal(parseAfterDate('', MADRID), null);
  });
});
