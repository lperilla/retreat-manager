import { randomUUID } from 'node:crypto';

import { AppError } from '../../../domain/errors.js';
import { RetreatStatus, createRetreat, deletionDate, hasEnded, isDeletionDue } from '../domain/Retreat.js';
import { getOrCreateActiveRetreat } from './activeRetreat.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Retreat data and end of life. When the retreat is over, every personal datum is deleted
 * automatically `retentionDays` after its last day (or earlier, on request): participants
 * (including allergies, needs and emergency contacts), letters, manual assignments, print
 * status, sync history, the attachment cache and exported files. Only the retreat's name,
 * dates and anonymous totals remain, and a new empty retreat starts. Letters received
 * before that moment are never imported again.
 */
export class RetreatUseCase {
  #retreats;
  #records;
  #purge;
  #countLetters;
  #clock;
  #logger;
  #idGenerator;
  #retentionDays;
  #timeZone;

  /**
   * @param {{
   *   retreats: import('./ports.js').RetreatRepositoryPort,
   *   participantRecords: import('./ports.js').ParticipantRecordRepositoryPort,
   *   purgeRetreatData: (retreatId: string) => Promise<void>,
   *   countLetters: () => Promise<number>,
   *   clock: import('../../../application/ports/ClockPort.js').ClockPort,
   *   logger: import('../../../application/ports/LoggerPort.js').LoggerPort,
   *   retentionDays: number,
   *   timeZone: string,
   *   idGenerator?: () => string,
   * }} deps
   */
  constructor({ retreats, participantRecords, purgeRetreatData, countLetters, clock, logger, retentionDays, timeZone, idGenerator = randomUUID }) {
    this.#retreats = retreats;
    this.#records = participantRecords;
    this.#purge = purgeRetreatData;
    this.#countLetters = countLetters;
    this.#clock = clock;
    this.#logger = logger;
    this.#retentionDays = retentionDays;
    this.#timeZone = timeZone;
    this.#idGenerator = idGenerator;
  }

  #active() {
    return getOrCreateActiveRetreat(this.#retreats, { now: this.#clock.now(), idGenerator: this.#idGenerator });
  }

  /** Active retreat with its deletion schedule, plus the closed ones (anonymous totals). */
  async get() {
    const retreat = await this.#active();
    const all = await this.#retreats.findAll();
    return { ...this.#view(retreat), previous: all.filter((r) => r.status === RetreatStatus.CLOSED).map((r) => this.#view(r)) };
  }

  /**
   * @param {{ name?: string, startDate?: string | null, endDate?: string | null }} input
   */
  async update(input) {
    const retreat = await this.#active();
    const updated = createRetreat({
      ...retreat,
      name: typeof input?.name === 'string' ? input.name : retreat.name,
      startDate: input?.startDate === undefined ? retreat.startDate : input.startDate,
      endDate: input?.endDate === undefined ? retreat.endDate : input.endDate,
    });
    await this.#retreats.save(updated);
    this.#logger.info({ retreatId: updated.id }, 'Retreat updated');
    return this.get();
  }

  /**
   * Closes the retreat now and deletes its data. The name must be typed as confirmation.
   * @param {{ confirmName: string }} input
   */
  async close(input) {
    const retreat = await this.#active();
    const typed = String(input?.confirmName ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (typed !== retreat.name.toLowerCase()) throw new AppError('RETREAT_CLOSE_CONFIRMATION', 400);
    await this.#closeAndDelete(retreat, 'manual');
    return this.get();
  }

  /**
   * Automatic deletion: run periodically. Returns true when a retreat was closed.
   * @returns {Promise<boolean>}
   */
  async enforceRetention() {
    const retreat = await this.#active();
    if (!isDeletionDue(retreat, this.#clock.now(), { retentionDays: this.#retentionDays, timeZone: this.#timeZone })) return false;
    await this.#closeAndDelete(retreat, 'retention');
    return true;
  }

  /**
   * @param {import('../domain/Retreat.js').Retreat} retreat
   * @param {'manual' | 'retention'} reason
   */
  async #closeAndDelete(retreat, reason) {
    const [participants, letters] = await Promise.all([this.#records.findByRetreat(retreat.id), this.#countLetters()]);
    await this.#purge(retreat.id);
    const now = this.#clock.now();
    await this.#retreats.save(
      createRetreat({ ...retreat, status: RetreatStatus.CLOSED, closedAt: now, summary: { participants: participants.length, letters } }),
    );
    await this.#retreats.save(
      createRetreat({ id: this.#idGenerator(), name: 'Nuevo retiro', status: RetreatStatus.ACTIVE, mailFrom: now, createdAt: now }),
    );
    this.#logger.warn({ retreatId: retreat.id, reason, participants: participants.length, letters }, 'Retreat closed and its data deleted');
  }

  /** @param {import('../domain/Retreat.js').Retreat} retreat */
  #view(retreat) {
    const now = this.#clock.now();
    const deletion = deletionDate(retreat, { retentionDays: this.#retentionDays, timeZone: this.#timeZone });
    return {
      id: retreat.id,
      name: retreat.name,
      startDate: retreat.startDate,
      endDate: retreat.endDate,
      status: retreat.status,
      ended: hasEnded(retreat, now, this.#timeZone),
      retentionDays: this.#retentionDays,
      deletionDate: retreat.status === RetreatStatus.ACTIVE ? deletion?.toISOString() ?? null : null,
      daysUntilDeletion:
        retreat.status === RetreatStatus.ACTIVE && deletion ? Math.max(0, Math.ceil((deletion.getTime() - now.getTime()) / DAY_MS)) : null,
      mailFrom: retreat.mailFrom?.toISOString() ?? null,
      closedAt: retreat.closedAt?.toISOString() ?? null,
      summary: retreat.summary ? { ...retreat.summary } : null,
    };
  }
}
