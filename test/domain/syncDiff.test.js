import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLetter } from '../../src/domain/entities/Letter.js';
import { syncDiff } from '../../src/domain/services/syncDiff.js';
import { assignedTo, makeLetter, needsReview } from '../helpers/domainFixtures.js';

const ref = (letter, deletedAt = null) => ({ messageId: letter.messageId, contentHash: letter.contentHash, deletedAt });

describe('syncDiff', () => {
  it('classifies added, updated, unchanged and deleted', () => {
    const kept = makeLetter({ messageId: 'kept' });
    const edited = makeLetter({ messageId: 'edited', cleanBody: 'Versión original' });
    const removed = makeLetter({ messageId: 'removed' });
    const fresh = makeLetter({ messageId: 'fresh' });
    const editedNow = createLetter({ ...edited, cleanBody: 'Versión corregida' });

    const diff = syncDiff({
      known: [ref(kept), ref(edited), ref(removed)],
      incoming: [kept, editedNow, fresh],
      deletedMessageIds: ['removed'],
    });

    assert.deepEqual(diff.added.map((l) => l.messageId), ['fresh']);
    assert.deepEqual(diff.updated.map((l) => l.messageId), ['edited']);
    assert.deepEqual(diff.unchanged, ['kept']);
    assert.deepEqual(diff.deleted, ['removed']);
    assert.deepEqual(diff.restored, []);
  });

  it('computes per-participant deltas from added letters only', () => {
    const known = makeLetter({ messageId: 'known', assignment: assignedTo(['ana-martin']) });
    const incoming = [
      known,
      makeLetter({ messageId: 'n1', assignment: assignedTo(['juan-perez']) }),
      makeLetter({ messageId: 'n2', assignment: assignedTo(['juan-perez', 'ana-martin']) }),
      makeLetter({ messageId: 'n3', assignment: needsReview(['pedro-sanchez']) }),
    ];
    const diff = syncDiff({ known: [ref(known)], incoming });
    assert.deepEqual(diff.perParticipantDeltas, [
      { participantId: 'juan-perez', newLetters: 2 },
      { participantId: 'ana-martin', newLetters: 1 },
    ]);
  });

  it('is idempotent: the same batch twice adds 0 letters the second time', () => {
    const batch = [makeLetter({ messageId: 'a' }), makeLetter({ messageId: 'b' })];
    const first = syncDiff({ known: [], incoming: batch });
    assert.equal(first.added.length, 2);

    const second = syncDiff({ known: first.added.map((l) => ref(l)), incoming: batch });
    assert.equal(second.added.length, 0);
    assert.equal(second.updated.length, 0);
    assert.deepEqual(second.unchanged, ['a', 'b']);
    assert.deepEqual(second.perParticipantDeltas, []);
  });

  it('ignores assignment changes when comparing content (recompute is not an update)', () => {
    const stored = makeLetter({ messageId: 'x', assignment: needsReview() });
    const reassigned = createLetter({ ...stored, assignment: assignedTo(['juan-perez']) });
    assert.deepEqual(syncDiff({ known: [ref(stored)], incoming: [reassigned] }).unchanged, ['x']);
  });

  it('collapses duplicated incoming messages by messageId', () => {
    const letter = makeLetter({ messageId: 'dup', assignment: assignedTo(['juan-perez']) });
    const diff = syncDiff({ known: [], incoming: [letter, letter] });
    assert.equal(diff.added.length, 1);
    assert.deepEqual(diff.perParticipantDeltas, [{ participantId: 'juan-perez', newLetters: 1 }]);
  });

  it('ignores deletions of unknown or already deleted letters; deletion wins over incoming', () => {
    const alreadyDeleted = makeLetter({ messageId: 'old' });
    const active = makeLetter({ messageId: 'active' });
    const diff = syncDiff({
      known: [ref(alreadyDeleted, new Date('2025-11-01T00:00:00Z')), ref(active)],
      incoming: [active, makeLetter({ messageId: 'never-seen' })],
      deletedMessageIds: ['old', 'unknown', 'active', 'never-seen'],
    });
    assert.deepEqual(diff.deleted, ['active']);
    assert.deepEqual(diff.added, []);
    assert.deepEqual(diff.unchanged, []);
  });

  it('restores a soft-deleted letter that reappears (reported as updated)', () => {
    const letter = makeLetter({ messageId: 'back' });
    const diff = syncDiff({ known: [ref(letter, new Date('2025-11-01T00:00:00Z'))], incoming: [letter] });
    assert.deepEqual(diff.updated.map((l) => l.messageId), ['back']);
    assert.deepEqual(diff.restored, ['back']);
    assert.deepEqual(diff.added, []);
  });

  it('accepts known refs as a Map and returns added letters chronologically', () => {
    const known = makeLetter({ messageId: 'k' });
    const later = makeLetter({ messageId: 'z', receivedAt: '2025-11-05T00:00:00Z' });
    const earlier = makeLetter({ messageId: 'y', receivedAt: '2025-11-04T00:00:00Z' });
    const diff = syncDiff({
      known: new Map([['k', { contentHash: known.contentHash }]]),
      incoming: [later, known, earlier],
    });
    assert.deepEqual(diff.added.map((l) => l.messageId), ['y', 'z']);
    assert.deepEqual(diff.unchanged, ['k']);
  });
});
