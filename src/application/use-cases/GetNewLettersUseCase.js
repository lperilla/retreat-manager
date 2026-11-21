import { compareParticipantsByName, indexParticipantsById } from '../../domain/entities/Participant.js';
import { assignedParticipantIds, isNewLetter } from '../../domain/entities/Letter.js';
import { AppError } from '../../domain/errors.js';
import { sortChronologically } from '../../domain/services/grouping.js';
import { presentLetter, presentParticipantRef } from '../services/presenters.js';

/**
 * "Novedades desde la última sincronización": letters not yet seen by staff, grouped by
 * participant. Unassigned / review letters are listed in their own group.
 */
export class GetNewLettersUseCase {
  #letters;
  #participants;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   * }} deps
   */
  constructor({ letterStore, participantRepository }) {
    this.#letters = letterStore;
    this.#participants = participantRepository;
  }

  /**
   * @param {{ participantId?: string | null }} [input]
   */
  async execute(input = {}) {
    const participantId = input.participantId ?? null;
    const participants = await this.#participants.findAll();
    const participantsById = indexParticipantsById(participants);
    if (participantId !== null && !participantsById.has(participantId)) {
      throw new AppError('PARTICIPANT_NOT_FOUND', 404, undefined, { participantId });
    }

    const fresh = sortChronologically((await this.#letters.findAll()).filter(isNewLetter));
    /** @type {Map<string, import('../../domain/entities/Letter.js').Letter[]>} */
    const byParticipant = new Map();
    const unassigned = [];
    for (const letter of fresh) {
      const ids = assignedParticipantIds(letter);
      if (ids.length === 0) {
        unassigned.push(letter);
        continue;
      }
      for (const id of ids) {
        if (participantId !== null && id !== participantId) continue;
        const list = byParticipant.get(id) ?? [];
        list.push(letter);
        byParticipant.set(id, list);
      }
    }

    const groups = [...byParticipant.entries()]
      .map(([id, letters]) => ({
        participant: presentParticipantRef(participantsById, id),
        count: letters.length,
        letters: letters.map((letter) => presentLetter(letter, { participantsById })),
      }))
      .sort((a, b) => compareParticipantsByName(a.participant, b.participant));

    const unassignedGroup =
      participantId === null
        ? { count: unassigned.length, letters: unassigned.map((letter) => presentLetter(letter, { participantsById })) }
        : { count: 0, letters: [] };

    const total = participantId === null ? fresh.length : groups.reduce((sum, group) => sum + group.count, 0);
    return { participantId, total, groups, unassigned: unassignedGroup };
  }
}
