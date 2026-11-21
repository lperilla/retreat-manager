import { createAssignmentOverride } from '../../domain/entities/AssignmentOverride.js';
import { indexParticipantsById } from '../../domain/entities/Participant.js';
import { AppError } from '../../domain/errors.js';
import { applyAssignmentOverride } from '../../domain/services/assignment.js';
import { resolveSelection } from '../../domain/services/batchSelection.js';
import { withMultiRecipientFlag } from '../../domain/services/heuristics.js';
import { presentLetter } from '../services/presenters.js';
import { requireString, requireStringArray } from '../services/validation.js';

/**
 * Review queue ("Por revisar") and manual assignment of any letter.
 * Manual decisions are stored as overrides by messageId and always win.
 */
export class ReviewAssignmentUseCase {
  #letters;
  #overrides;
  #participants;
  #strategy;
  #clock;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   overrideRepository: import('../ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   assignmentStrategy: import('../../domain/services/assignment.js').ContentAssignmentStrategy,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   * }} deps
   */
  constructor({ letterStore, overrideRepository, participantRepository, assignmentStrategy, clock }) {
    this.#letters = letterStore;
    this.#overrides = overrideRepository;
    this.#participants = participantRepository;
    this.#strategy = assignmentStrategy;
    this.#clock = clock;
  }

  /** Active NEEDS_REVIEW letters (chronological) with ranked suggestions. */
  async listQueue() {
    const [letters, participants] = await Promise.all([this.#letters.findNeedingReview(), this.#participants.findAll()]);
    const participantsById = indexParticipantsById(participants);
    return { total: letters.length, letters: letters.map((letter) => presentLetter(letter, { participantsById })) };
  }

  /**
   * Assigns (or reassigns) a letter to one or more participants.
   * @param {{ messageId: string, participantIds: string[] }} input
   */
  async assign(input) {
    const requested = requireStringArray(input?.participantIds, 'participantIds', { max: 50 });
    const participants = await this.#participants.findAll();
    const participantIds = resolveSelection(requested, participants);
    return this.#saveOverride(input.messageId, participantIds, participants);
  }

  /**
   * "Dejar sin asignar": the letter belongs to nobody (leaves the review queue, never dropped).
   * @param {{ messageId: string }} input
   */
  async leaveUnassigned(input) {
    return this.#saveOverride(input?.messageId, [], await this.#participants.findAll());
  }

  /**
   * Removes the manual decision and lets the heuristics decide again.
   * @param {{ messageId: string }} input
   */
  async resetToAutomatic(input) {
    const letter = await this.#requireLetter(input?.messageId);
    const participants = await this.#participants.findAll();
    await this.#overrides.delete(letter.messageId);
    const assignment = this.#strategy.assign(
      { subject: letter.subject, body: letter.cleanBody, from: letter.from },
      participants,
    );
    return this.#applyAssignment(letter, assignment, participants);
  }

  /**
   * @param {unknown} messageIdInput
   * @param {string[]} participantIds
   * @param {import('../../domain/entities/Participant.js').Participant[]} participants
   */
  async #saveOverride(messageIdInput, participantIds, participants) {
    const letter = await this.#requireLetter(messageIdInput);
    const override = createAssignmentOverride({
      messageId: letter.messageId,
      participantIds,
      updatedAt: this.#clock.now(),
    });
    await this.#overrides.save(override);
    return this.#applyAssignment(letter, applyAssignmentOverride(letter.assignment, override), participants);
  }

  /**
   * @param {import('../../domain/entities/Letter.js').Letter} letter
   * @param {import('../../domain/entities/Assignment.js').Assignment} assignment
   * @param {import('../../domain/entities/Participant.js').Participant[]} participants
   */
  async #applyAssignment(letter, assignment, participants) {
    const flags = withMultiRecipientFlag(letter.flags, assignment.participantIds);
    await this.#letters.updateAssignments([{ messageId: letter.messageId, assignment, flags }]);
    const updated = await this.#letters.findById(letter.messageId);
    return presentLetter(updated ?? letter, { participantsById: indexParticipantsById(participants) });
  }

  /**
   * @param {unknown} messageIdInput
   */
  async #requireLetter(messageIdInput) {
    const messageId = requireString(messageIdInput, 'messageId', { max: 200 });
    const letter = await this.#letters.findById(messageId);
    if (!letter || letter.deletedAt) throw new AppError('LETTER_NOT_FOUND', 404, undefined, { messageId });
    return letter;
  }
}
