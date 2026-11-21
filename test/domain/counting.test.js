import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AssignmentStatus } from '../../src/domain/constants.js';
import { createAssignment } from '../../src/domain/entities/Assignment.js';
import { createParticipant } from '../../src/domain/entities/Participant.js';
import { computeParticipantStats, sortParticipantStats, summarizeRetreat } from '../../src/domain/services/counting.js';
import { assignedTo, makeLetter, needsReview } from '../helpers/domainFixtures.js';

const people = [
  createParticipant({ id: 'beatriz', displayName: 'Beatriz Gil' }),
  createParticipant({ id: 'alvaro', displayName: 'Álvaro Ruiz' }),
  createParticipant({ id: 'carlos', displayName: 'Carlos Peña' }),
  createParticipant({ id: 'diana', displayName: 'Diana Sanz' }),
  createParticipant({ id: 'elena', displayName: 'Elena Mora' }),
];

const to = (...ids) => makeLetter({ assignment: assignedTo(ids) });

describe('summarizeRetreat', () => {
  it('lists every participant tied for most and fewest letters (fewest includes zero)', () => {
    const letters = [to('beatriz'), to('beatriz'), to('alvaro'), to('alvaro'), to('carlos')];
    const summary = summarizeRetreat({ participants: people, letters });

    assert.equal(summary.totalLetters, 5);
    assert.equal(summary.participantCount, 5);
    assert.equal(summary.participantsWithLetters, 3);
    assert.equal(summary.participantsWithoutLetters, 2);
    assert.deepEqual(summary.mostLetters, { count: 2, participantIds: ['alvaro', 'beatriz'] });
    assert.deepEqual(summary.fewestLetters, { count: 0, participantIds: ['diana', 'elena'] });
    assert.deepEqual(summary.zeroLetterParticipantIds, ['diana', 'elena']);
  });

  it('sorts tie arrays with Spanish collation (Á sorts with A)', () => {
    const summary = summarizeRetreat({ participants: people, letters: [] });
    assert.deepEqual(summary.fewestLetters.participantIds, ['alvaro', 'beatriz', 'carlos', 'diana', 'elena']);
    assert.deepEqual(
      summary.perParticipant.map((s) => s.participantId),
      ['alvaro', 'beatriz', 'carlos', 'diana', 'elena'],
    );
  });

  it('fewest is the minimum when nobody has zero letters', () => {
    const letters = [to('alvaro', 'beatriz', 'carlos', 'diana', 'elena'), to('alvaro'), to('beatriz')];
    const summary = summarizeRetreat({ participants: people, letters });
    assert.deepEqual(summary.fewestLetters, { count: 1, participantIds: ['carlos', 'diana', 'elena'] });
    assert.deepEqual(summary.zeroLetterParticipantIds, []);
  });

  it('most is empty when nobody has letters', () => {
    const summary = summarizeRetreat({ participants: people, letters: [] });
    assert.deepEqual(summary.mostLetters, { count: 0, participantIds: [] });
    assert.equal(summary.fewestLetters.count, 0);
  });

  it('excludes soft-deleted letters from every count', () => {
    const deleted = makeLetter({ assignment: assignedTo(['alvaro']), deletedAt: '2025-11-04T00:00:00Z' });
    const deletedReview = makeLetter({ assignment: needsReview(), deletedAt: '2025-11-04T00:00:00Z' });
    const summary = summarizeRetreat({ participants: people, letters: [deleted, deletedReview, to('beatriz')] });
    assert.equal(summary.totalLetters, 1);
    assert.equal(summary.reviewQueueSize, 0);
    assert.equal(summary.newLettersCount, 1);
    assert.deepEqual(summary.mostLetters, { count: 1, participantIds: ['beatriz'] });
    assert.ok(summary.zeroLetterParticipantIds.includes('alvaro'));
  });

  it('review and unassigned letters are in the total but count for nobody', () => {
    const unassigned = makeLetter({ assignment: createAssignment({ status: AssignmentStatus.UNASSIGNED }) });
    const summary = summarizeRetreat({ participants: people, letters: [makeLetter({ assignment: needsReview(['alvaro']) }), unassigned] });
    assert.equal(summary.totalLetters, 2);
    assert.equal(summary.reviewQueueSize, 1);
    assert.equal(summary.unassignedCount, 1);
    assert.equal(summary.participantsWithLetters, 0);
  });

  it('counts new letters globally and per participant', () => {
    const seen = makeLetter({ assignment: assignedTo(['alvaro']), seenByStaff: true });
    const fresh = makeLetter({ assignment: assignedTo(['alvaro']) });
    const summary = summarizeRetreat({ participants: people, letters: [seen, fresh, makeLetter({ assignment: needsReview() })] });
    assert.equal(summary.newLettersCount, 2);
    const alvaro = summary.perParticipant.find((s) => s.participantId === 'alvaro');
    assert.equal(alvaro?.letterCount, 2);
    assert.equal(alvaro?.newCount, 1);
  });

  it('deduplicates letters by messageId', () => {
    const letter = makeLetter({ messageId: 'dup', assignment: assignedTo(['alvaro']) });
    const summary = summarizeRetreat({ participants: people, letters: [letter, letter] });
    assert.equal(summary.totalLetters, 1);
    assert.equal(summary.perParticipant.find((s) => s.participantId === 'alvaro')?.letterCount, 1);
  });

  it('ignores letters assigned to unknown participants in per-participant counts', () => {
    const summary = summarizeRetreat({ participants: people, letters: [to('ghost')] });
    assert.equal(summary.totalLetters, 1);
    assert.equal(summary.participantsWithLetters, 0);
  });

  it('carries sync metadata when provided', () => {
    const lastSyncAt = new Date('2025-11-04T08:00:00Z');
    const summary = summarizeRetreat({ participants: people, letters: [], lastSyncAt, syncStatus: 'idle' });
    assert.equal(summary.lastSyncAt, lastSyncAt);
    assert.equal(summary.syncStatus, 'idle');
  });
});

describe('sortParticipantStats', () => {
  it('sorts by count desc with alphabetical tie-break, or alphabetically', () => {
    const stats = computeParticipantStats(people, [to('elena'), to('elena'), to('carlos'), to('beatriz')]);
    assert.deepEqual(
      sortParticipantStats(stats, 'count').map((s) => s.participantId),
      ['elena', 'beatriz', 'carlos', 'alvaro', 'diana'],
    );
    assert.deepEqual(
      sortParticipantStats(stats, 'name').map((s) => s.participantId),
      ['alvaro', 'beatriz', 'carlos', 'diana', 'elena'],
    );
  });
});
