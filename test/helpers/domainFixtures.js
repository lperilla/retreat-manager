import { AssignmentStatus, SignalType } from '../../src/domain/constants.js';
import { createAssignment } from '../../src/domain/entities/Assignment.js';
import { createLetter } from '../../src/domain/entities/Letter.js';
import { createParticipant } from '../../src/domain/entities/Participant.js';

/** Shared participants: two "María" (ambiguous first name), aliases, accents. */
export const PARTICIPANTS = Object.freeze([
  createParticipant({ id: 'maria-garcia', displayName: 'María García', aliases: ['Mari'] }),
  createParticipant({ id: 'maria-lopez', displayName: 'María López' }),
  createParticipant({ id: 'juan-perez', displayName: 'Juan Pérez', aliases: ['Juanito'] }),
  createParticipant({ id: 'lucia-fernandez', displayName: 'Lucía Fernández' }),
  createParticipant({ id: 'pedro-sanchez', displayName: 'Pedro Sánchez' }),
  createParticipant({ id: 'ana-martin', displayName: 'Ana Martín' }),
]);

let sequence = 0;

/**
 * Builds a letter with sensible defaults.
 * @param {Record<string, unknown>} [overrides]
 */
export function makeLetter(overrides = {}) {
  sequence += 1;
  return createLetter({
    messageId: `msg-${String(sequence).padStart(4, '0')}`,
    threadId: `thr-${sequence}`,
    from: 'Familia Ejemplo <familia@example.com>',
    to: 'retiro@example.com',
    subject: 'Carta',
    receivedAt: '2025-11-03T10:00:00Z',
    cleanBody: 'Querido participante:\nTe pensamos mucho estos días.',
    ...overrides,
  });
}

/**
 * Assignment helper for tests that do not exercise the strategy.
 * @param {string[]} participantIds
 */
export function assignedTo(participantIds) {
  return createAssignment({
    participantIds,
    status: AssignmentStatus.ASSIGNED,
    signal: SignalType.MANUAL,
    confidence: 1,
  });
}

export function needsReview(suggestedParticipantIds = []) {
  return createAssignment({ status: AssignmentStatus.NEEDS_REVIEW, suggestedParticipantIds });
}
