import { AssignmentStatus } from '../../domain/constants.js';
import { indexParticipantsById } from '../../domain/entities/Participant.js';
import { isLetterActive } from '../../domain/entities/Letter.js';
import { applyAssignmentOverride } from '../../domain/services/assignment.js';
import { withMultiRecipientFlag } from '../../domain/services/heuristics.js';
import { presentParticipantRef } from '../services/presenters.js';

const MAX_LISTED_CHANGES = 200;

/**
 * @param {import('../../domain/entities/Assignment.js').Assignment} assignment
 * @returns {string}
 */
function assignmentKey(assignment) {
  return JSON.stringify([
    assignment.status,
    [...assignment.participantIds].sort(),
    assignment.signal,
    [...assignment.suggestedParticipantIds],
  ]);
}

/**
 * "Reasignar cartas": re-runs the assignment pipeline over stored letters (stored bodies,
 * no mail-source calls). Letters with a manual override keep it. Run it after the
 * participant list or aliases change.
 */
export class RecomputeAssignmentsUseCase {
  #letters;
  #overrides;
  #participants;
  #strategy;
  #logger;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   overrideRepository: import('../ports/AssignmentOverrideRepositoryPort.js').AssignmentOverrideRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   assignmentStrategy: import('../../domain/services/assignment.js').ContentAssignmentStrategy,
   *   logger: import('../ports/LoggerPort.js').LoggerPort,
   * }} deps
   */
  constructor({ letterStore, overrideRepository, participantRepository, assignmentStrategy, logger }) {
    this.#letters = letterStore;
    this.#overrides = overrideRepository;
    this.#participants = participantRepository;
    this.#strategy = assignmentStrategy;
    this.#logger = logger;
  }

  async execute() {
    const [participants, letters, overrides] = await Promise.all([
      this.#participants.findAll(),
      this.#letters.findAll(),
      this.#overrides.findAll(),
    ]);
    const participantsById = indexParticipantsById(participants);
    const overrideById = new Map(overrides.map((override) => [override.messageId, override]));
    const describe = (/** @type {import('../../domain/entities/Assignment.js').Assignment} */ a) => ({
      status: a.status,
      participants: a.participantIds.map((id) => presentParticipantRef(participantsById, id)),
    });

    const updates = [];
    const changes = [];
    let manual = 0;
    const active = letters.filter(isLetterActive);

    for (const letter of active) {
      const override = overrideById.get(letter.messageId) ?? null;
      let next;
      if (override) {
        manual += 1;
        next = applyAssignmentOverride(letter.assignment, override);
      } else {
        next = this.#strategy.assign({ subject: letter.subject, body: letter.cleanBody, from: letter.from }, participants);
      }
      if (assignmentKey(next) === assignmentKey(letter.assignment)) continue;
      updates.push({
        messageId: letter.messageId,
        assignment: next,
        flags: withMultiRecipientFlag(letter.flags, next.participantIds),
      });
      changes.push({
        messageId: letter.messageId,
        subject: letter.subject,
        manual: Boolean(override),
        before: describe(letter.assignment),
        after: describe(next),
      });
    }

    if (updates.length > 0) await this.#letters.updateAssignments(updates);

    const statusAfter = new Map(updates.map((u) => [u.messageId, u.assignment.status]));
    const statusOf = (/** @type {import('../../domain/entities/Letter.js').Letter} */ letter) =>
      statusAfter.get(letter.messageId) ?? letter.assignment.status;

    const summary = {
      examined: active.length,
      changed: updates.length,
      unchanged: active.length - updates.length,
      manualOverrides: manual,
      assigned: active.filter((l) => statusOf(l) === AssignmentStatus.ASSIGNED).length,
      needsReview: active.filter((l) => statusOf(l) === AssignmentStatus.NEEDS_REVIEW).length,
      unassigned: active.filter((l) => statusOf(l) === AssignmentStatus.UNASSIGNED).length,
      changes: changes.slice(0, MAX_LISTED_CHANGES),
      truncated: changes.length > MAX_LISTED_CHANGES,
    };
    this.#logger.info(
      { examined: summary.examined, changed: summary.changed, manualOverrides: summary.manualOverrides },
      'Assignments recomputed',
    );
    return summary;
  }
}
