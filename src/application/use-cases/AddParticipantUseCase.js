import { createParticipant, slugify, sortParticipantsByName } from '../../domain/entities/Participant.js';
import { AppError } from '../../domain/errors.js';
import { requireString } from '../services/validation.js';

/**
 * Adds a participant while letters keep arriving (someone missing from the initial list).
 *
 * - The id is derived from the name; a different person with the same slug gets "-2", "-3"…
 *   The same name (ignoring accents/case) or an existing alias is refused as a duplicate.
 * - The list is written back to PARTICIPANTS_FILE (when there is one) so it survives restarts.
 * - Assignments are recomputed afterwards: letters waiting in review that name the new
 *   participant are assigned automatically. Manual decisions (overrides) are never touched.
 */
export class AddParticipantUseCase {
  #participants;
  #participantFile;
  #recompute;
  #logger;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   participantFile?: import('../ports/ParticipantListFilePort.js').ParticipantListFilePort | null,
   *   recomputeAssignments: { execute: () => Promise<any> },
   *   logger: import('../ports/LoggerPort.js').LoggerPort,
   * }} deps
   */
  constructor({ participantRepository, participantFile = null, recomputeAssignments, logger }) {
    this.#participants = participantRepository;
    this.#participantFile = participantFile;
    this.#recompute = recomputeAssignments;
    this.#logger = logger;
  }

  /**
   * @param {{ displayName: string, aliases?: string[] }} input
   */
  async execute(input) {
    const displayName = requireString(input?.displayName, 'displayName', { max: 120 });
    const aliasesInput = input?.aliases ?? [];
    if (!Array.isArray(aliasesInput) || aliasesInput.length > 20 || aliasesInput.some((a) => typeof a !== 'string' || a.length > 120)) {
      throw new AppError('INVALID_PARTICIPANT', 400, undefined, { reason: 'aliases must be up to 20 short strings' });
    }

    const existing = await this.#participants.findAll();
    const draft = createParticipant({ displayName, aliases: aliasesInput });
    if (!slugify(draft.displayName)) {
      throw new AppError('INVALID_PARTICIPANT', 400, undefined, { reason: 'the name needs letters or digits' });
    }

    const fold = (/** @type {string} */ value) => slugify(value);
    const taken = new Map();
    for (const participant of existing) {
      for (const name of [participant.displayName, ...participant.aliases]) taken.set(fold(name), participant);
    }
    for (const name of [draft.displayName, ...draft.aliases]) {
      const clash = taken.get(fold(name));
      if (clash) {
        throw new AppError('DUPLICATE_PARTICIPANT', 409, `Ya existe un participante con ese nombre o alias: ${clash.displayName}.`, {
          participantId: clash.id,
        });
      }
    }

    const ids = new Set(existing.map((participant) => participant.id));
    let id = draft.id;
    for (let n = 2; ids.has(id); n += 1) id = `${draft.id}-${n}`;
    const participant = createParticipant({ id, displayName: draft.displayName, aliases: [...draft.aliases] });

    const next = sortParticipantsByName([...existing, participant]);
    await this.#participants.replaceAll(next);
    if (this.#participantFile) await this.#participantFile.write(next);
    this.#logger.info({ participantId: participant.id }, 'Participant added');

    const recompute = await this.#recompute.execute();
    return {
      participant: { id: participant.id, displayName: participant.displayName, aliases: [...participant.aliases] },
      savedToFile: this.#participantFile !== null,
      recompute: {
        changed: recompute.changed,
        assigned: recompute.assigned,
        needsReview: recompute.needsReview,
        unassigned: recompute.unassigned,
        assignedToNew: recompute.changes.filter((/** @type {any} */ change) =>
          (change.after?.participants ?? []).some((/** @type {any} */ p) => p.id === participant.id),
        ).length,
      },
    };
  }
}
