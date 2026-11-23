import { AssignmentStatus } from '../../domain/constants.js';
import { createAssignmentOverride } from '../../domain/entities/AssignmentOverride.js';
import { indexParticipantsById } from '../../domain/entities/Participant.js';
import { AppError } from '../../domain/errors.js';
import { applyAssignmentOverride } from '../../domain/services/assignment.js';
import { resolveSelection } from '../../domain/services/batchSelection.js';
import { withMultiRecipientFlag } from '../../domain/services/heuristics.js';
import { detectRecipientHints } from '../../domain/services/recipientHints.js';
import { cleanForAnalysis, normalizeText } from '../../domain/services/text.js';
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
  #changes;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   overrideRepository: import('../ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   assignmentStrategy: import('../../domain/services/assignment.js').ContentAssignmentStrategy,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   changes?: import('../services/MailChangeRecorder.js').MailChangeRecorder | null,
   * }} deps
   */
  constructor({ letterStore, overrideRepository, participantRepository, assignmentStrategy, clock, changes = null }) {
    this.#letters = letterStore;
    this.#overrides = overrideRepository;
    this.#participants = participantRepository;
    this.#strategy = assignmentStrategy;
    this.#clock = clock;
    this.#changes = changes;
  }

  /**
   * Active NEEDS_REVIEW letters (chronological) with ranked suggestions, plus the letters
   * left "Sin asignar", which stay reachable so they can be assigned later (for example
   * once their recipient has been added as a participant).
   */
  async listQueue() {
    const [letters, all, participants] = await Promise.all([
      this.#letters.findNeedingReview(),
      this.#letters.findAll(),
      this.#participants.findAll(),
    ]);
    const participantsById = indexParticipantsById(participants);
    const byDate = (/** @type {any} */ a, /** @type {any} */ b) => a.receivedAt.getTime() - b.receivedAt.getTime();
    const unassigned = all
      .filter((letter) => !letter.deletedAt && letter.assignment.status === AssignmentStatus.UNASSIGNED)
      .sort(byDate);
    // Letters of withdrawn participants ("no está en el retiro"): kept and listed apart.
    const withdrawnIds = new Set(participants.filter((p) => p.status === 'withdrawn').map((p) => p.id));
    const withdrawn = all
      .filter((letter) => !letter.deletedAt && letter.assignment.participantIds.some((id) => withdrawnIds.has(id)))
      .sort(byDate);
    // "Destinatario detectado": the name written in the letter, and whether it is a known participant.
    const knownNames = new Set(participants.flatMap((p) => [p.displayName, ...p.aliases].map((n) => normalizeText(n))));
    const withHint = (/** @type {import('../../domain/entities/Letter.js').Letter} */ letter) => {
      const [hint] = detectRecipientHints({ subject: letter.subject, body: cleanForAnalysis({ body: letter.cleanBody, from: letter.from }) });
      return {
        ...presentLetter(letter, { participantsById }),
        // Creating a participant from the letter needs at least a name and a surname.
        detectedRecipient: hint
          ? { name: hint, known: knownNames.has(normalizeText(hint)), canCreate: !knownNames.has(normalizeText(hint)) && hint.trim().split(/\s+/).length >= 2 }
          : null,
      };
    };
    return {
      total: letters.length,
      letters: letters.map(withHint),
      unassigned: { total: unassigned.length, letters: unassigned.map(withHint) },
      withdrawn: { total: withdrawn.length, letters: withdrawn.map((letter) => presentLetter(letter, { participantsById })) },
    };
  }

  /**
   * Assigns (or reassigns) a letter to one or more participants.
   * @param {{ messageId: string, participantIds: string[], actor?: string }} input
   */
  async assign(input) {
    const requested = requireStringArray(input?.participantIds, 'participantIds', { max: 50 });
    const participants = await this.#participants.findAll();
    const participantIds = resolveSelection(requested, participants);
    return this.#saveOverride(input.messageId, participantIds, participants, input.actor, 'assignment.set');
  }

  /**
   * "Dejar sin asignar": the letter belongs to nobody (leaves the review queue, never dropped).
   * @param {{ messageId: string, actor?: string }} input
   */
  async leaveUnassigned(input) {
    return this.#saveOverride(input?.messageId, [], await this.#participants.findAll(), input?.actor, 'assignment.unassigned');
  }

  /**
   * Removes the manual decision and lets the heuristics decide again.
   * @param {{ messageId: string, actor?: string }} input
   */
  async resetToAutomatic(input) {
    const letter = await this.#requireLetter(input?.messageId);
    const participants = await this.#participants.findAll();
    await this.#overrides.delete(letter.messageId);
    const assignment = this.#strategy.assign(
      { subject: letter.subject, body: letter.cleanBody, from: letter.from },
      participants,
    );
    const view = await this.#applyAssignment(letter, assignment, participants);
    await this.#changes?.record({ actor: input?.actor, action: 'assignment.reset', messageIds: [letter.messageId], participantIds: assignment.participantIds });
    return view;
  }

  /**
   * @param {unknown} messageIdInput
   * @param {string[]} participantIds
   * @param {import('../../domain/entities/Participant.js').Participant[]} participants
   * @param {unknown} actor
   * @param {string} action
   */
  async #saveOverride(messageIdInput, participantIds, participants, actor, action) {
    const letter = await this.#requireLetter(messageIdInput);
    const override = createAssignmentOverride({
      messageId: letter.messageId,
      participantIds,
      updatedAt: this.#clock.now(),
    });
    await this.#overrides.save(override);
    const view = await this.#applyAssignment(letter, applyAssignmentOverride(letter.assignment, override), participants);
    await this.#changes?.record({ actor, action, messageIds: [letter.messageId], participantIds });
    return view;
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
