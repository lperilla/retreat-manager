import { randomUUID } from 'node:crypto';

import { createParticipant, sortParticipantsByName } from '../../../domain/entities/Participant.js';
import { AppError } from '../../../domain/errors.js';
import { getOrCreateActiveRetreat } from '../application/activeRetreat.js';
import { legacyToRecord } from './records.js';

/**
 * ParticipantRepositoryPort of the LETTERS module, served by the participants module:
 * the participants of the active retreat, projected to what letters need (id, name,
 * aliases, structured name for matching, status). This is the only bridge between the two
 * modules, so the letters use cases did not change when participants got their own module.
 * @implements {import('../../../application/ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort}
 */
export class ParticipantDirectory {
  #records;
  #retreats;
  #clock;
  #idGenerator;

  /**
   * @param {{
   *   records: import('../application/ports.js').ParticipantRecordRepositoryPort,
   *   retreats: import('../application/ports.js').RetreatRepositoryPort,
   *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
   *   idGenerator?: () => string,
   * }} deps
   */
  constructor({ records, retreats, clock, idGenerator = randomUUID }) {
    this.#records = records;
    this.#retreats = retreats;
    this.#clock = clock;
    this.#idGenerator = idGenerator;
  }

  async #retreatId() {
    return (await getOrCreateActiveRetreat(this.#retreats, { now: this.#clock.now(), idGenerator: this.#idGenerator })).id;
  }

  async findAll() {
    const records = await this.#records.findByRetreat(await this.#retreatId());
    return sortParticipantsByName(records.map(toLettersParticipant));
  }

  /** @param {string} id */
  async findById(id) {
    const [record, retreatId] = await Promise.all([this.#records.findById(id), this.#retreatId()]);
    return record && record.retreatId === retreatId ? toLettersParticipant(record) : null;
  }

  /**
   * Seeds the active retreat with old-style participants (demo data, tests, imports),
   * keeping the profile data of those that already exist.
   * @param {Array<{ id: string, displayName: string, aliases?: readonly string[], nameParts?: any, status?: string }>} participants
   */
  async replaceAll(participants) {
    const retreatId = await this.#retreatId();
    const now = this.#clock.now();
    const valid = participants.map((participant) => createParticipant(participant));
    const ids = new Set();
    for (const participant of valid) {
      if (ids.has(participant.id)) {
        throw new AppError('DUPLICATE_PARTICIPANT', 409, undefined, { participantId: participant.id });
      }
      ids.add(participant.id);
    }
    const records = [];
    for (const participant of valid) {
      const existing = await this.#records.findById(participant.id);
      records.push(legacyToRecord(participant, { retreatId, now, existing: existing?.retreatId === retreatId ? existing : null }));
    }
    await this.#records.replaceForRetreat(retreatId, records);
  }

  async deleteAll() {
    return this.#records.deleteByRetreat(await this.#retreatId());
  }
}

/**
 * @param {import('../domain/ParticipantRecord.js').ParticipantRecord} record
 * @returns {import('../../../domain/entities/Participant.js').Participant}
 */
export function toLettersParticipant(record) {
  return createParticipant({
    id: record.id,
    displayName: record.displayName,
    aliases: [...record.aliases],
    // A name split automatically from an old single field is only used as a whole until a
    // person reviews it (a wrong split would produce wrong variants).
    nameParts: record.nameNeedsReview
      ? null
      : { givenNames: record.givenNames, firstSurname: record.firstSurname, secondSurname: record.secondSurname },
    status: record.status,
  });
}
