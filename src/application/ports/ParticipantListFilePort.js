import { definePort } from './definePort.js';

/**
 * Durable copy of the participant list (PARTICIPANTS_FILE). The list is loaded from it at
 * startup, so participants added from the dashboard must be written back or they would be
 * lost on the next restart.
 *
 * @typedef {Object} ParticipantListFilePort
 * @property {(participants: import('../../domain/entities/Participant.js').Participant[]) => Promise<void>} write
 */

export const ParticipantListFilePort = definePort('ParticipantListFilePort', ['write']);
