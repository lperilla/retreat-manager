import { DEFAULTS, PrintStatusValue } from '../../domain/constants.js';
import { indexParticipantsById, isParticipantActive } from '../../domain/entities/Participant.js';
import { isPendingPrint } from '../../domain/entities/PrintStatus.js';
import { sortParticipantStats, summarizeRetreat } from '../../domain/services/counting.js';
import { normalizeText } from '../../domain/services/text.js';
import { presentParticipantRef, toIso } from '../services/presenters.js';
import { buildSyncStatusView } from '../services/syncStatusView.js';
import { oneOf } from '../services/validation.js';

/** Directory filters ("con cartas", "sin cartas", "pendiente", "impresa", "con avisos", "con novedades"). */
export const DIRECTORY_FILTERS = Object.freeze([
  'all',
  'with-letters',
  'without-letters',
  'pending',
  'printed',
  'with-warnings',
  'with-news',
]);

export const DIRECTORY_SORTS = Object.freeze(['name', 'count']);

/**
 * @typedef {Object} DirectoryRow
 * @property {string}      participantId
 * @property {string}      displayName
 * @property {string[]}    aliases
 * @property {number}      letterCount
 * @property {number}      newCount
 * @property {number}      warningCount
 * @property {string}      printStatus  'pending' | 'printed'
 * @property {string|null} printedAt
 */

/** @type {Record<string, (row: DirectoryRow) => boolean>} */
const FILTER_PREDICATES = {
  all: () => true,
  'with-letters': (row) => row.letterCount > 0,
  'without-letters': (row) => row.letterCount === 0,
  pending: (row) => row.printStatus === PrintStatusValue.PENDING,
  printed: (row) => row.printStatus === PrintStatusValue.PRINTED,
  'with-warnings': (row) => row.warningCount > 0,
  'with-news': (row) => row.newCount > 0,
};

/**
 * Dashboard data: KPIs, directory rows and sync widget state. Reads only local storage.
 */
export class GetDashboardOverviewUseCase {
  #participants;
  #letters;
  #printStatuses;
  #syncState;
  #clock;
  #minIntervalSeconds;

  /**
   * @param {{
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   syncStateRepository: import('../ports/SyncStateRepositoryPort.js').SyncStateRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   minIntervalSeconds?: number,
   * }} deps
   */
  constructor({ participantRepository, letterStore, printStatusRepository, syncStateRepository, clock, minIntervalSeconds }) {
    this.#participants = participantRepository;
    this.#letters = letterStore;
    this.#printStatuses = printStatusRepository;
    this.#syncState = syncStateRepository;
    this.#clock = clock;
    this.#minIntervalSeconds = minIntervalSeconds ?? DEFAULTS.SYNC_MIN_INTERVAL_SECONDS;
  }

  /**
   * @param {{ search?: string, filter?: string, sortBy?: string }} [input]
   */
  async execute(input = {}) {
    const filter = oneOf(input.filter, 'filter', DIRECTORY_FILTERS, 'all');
    const sortBy = oneOf(input.sortBy, 'sortBy', DIRECTORY_SORTS, 'name');
    const search = typeof input.search === 'string' ? normalizeText(input.search) : '';

    const [participants, letters, statuses, state] = await Promise.all([
      this.#participants.findAll(),
      this.#letters.findAll(),
      this.#printStatuses.findAll(),
      this.#syncState.get(),
    ]);
    const participantsById = indexParticipantsById(participants);
    const sync = buildSyncStatusView(state, {
      now: this.#clock.now(),
      minIntervalSeconds: this.#minIntervalSeconds,
      participantsById,
    });
    // Withdrawn participants leave the directory, the KPIs and the print batches; their
    // letters are still counted as received and stay reachable from "Por revisar".
    const active = participants.filter(isParticipantActive);
    const summary = summarizeRetreat({ participants: active, letters, lastSyncAt: state.lastSuccessAt, syncStatus: sync.status });
    const statusById = new Map(statuses.map((s) => [s.participantId, s]));

    /** @type {DirectoryRow[]} */
    const allRows = summary.perParticipant.map((stats) => {
      const printStatus = statusById.get(stats.participantId);
      return {
        participantId: stats.participantId,
        displayName: stats.displayName,
        aliases: [...(participantsById.get(stats.participantId)?.aliases ?? [])],
        letterCount: stats.letterCount,
        newCount: stats.newCount,
        warningCount: stats.warningCount,
        printStatus: isPendingPrint(printStatus) ? PrintStatusValue.PENDING : PrintStatusValue.PRINTED,
        printedAt: toIso(printStatus?.printedAt),
      };
    });

    const matchesSearch = (/** @type {DirectoryRow} */ row) =>
      !search ||
      normalizeText(row.displayName).includes(search) ||
      row.aliases.some((alias) => normalizeText(alias).includes(search));
    const rows = sortParticipantStats(
      allRows.filter((row) => FILTER_PREDICATES[filter](row) && matchesSearch(row)),
      /** @type {'name' | 'count'} */ (sortBy),
    );

    const refs = (/** @type {readonly string[]} */ ids) => ids.map((id) => presentParticipantRef(participantsById, id));

    return {
      kpis: {
        totalLetters: summary.totalLetters,
        participantCount: summary.participantCount,
        participantsWithLetters: summary.participantsWithLetters,
        participantsWithoutLetters: summary.participantsWithoutLetters,
        mostLetters: { count: summary.mostLetters.count, participants: refs(summary.mostLetters.participantIds) },
        fewestLetters: { count: summary.fewestLetters.count, participants: refs(summary.fewestLetters.participantIds) },
        zeroLetterParticipants: refs(summary.zeroLetterParticipantIds),
        reviewQueueSize: summary.reviewQueueSize,
        unassignedCount: summary.unassignedCount,
        newLettersCount: summary.newLettersCount,
        flaggedLettersCount: summary.flaggedLettersCount,
        printedCount: allRows.filter((row) => row.printStatus === PrintStatusValue.PRINTED).length,
      },
      directory: { filter, sortBy, search: input.search ?? '', total: allRows.length, rows },
      sync,
    };
  }
}
