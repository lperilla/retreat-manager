/**
 * Single composition root (manual dependency injection). The web entrypoint builds
 * its container here.
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AssignmentOverrideRepositoryPort,
  AttachmentProcessorPort,
  AttachmentSourcePort,
  ClockPort,
  ExportRendererPort,
  ExportStoragePort,
  LetterStoreRepositoryPort,
  LoggerPort,
  MailSourcePort,
  ParticipantRepositoryPort,
  PrintStatusRepositoryPort,
  SyncStateRepositoryPort,
} from '../application/ports/index.js';
import {
  ExportBatchLettersUseCase,
  GetAttachmentUseCase,
  GetDashboardOverviewUseCase,
  GetNewLettersUseCase,
  GetSyncStatusUseCase,
  GroupParticipantLettersUseCase,
  MarkLettersSeenUseCase,
  PreparePrintViewUseCase,
  RecomputeAssignmentsUseCase,
  ReviewAssignmentUseCase,
  SearchRawLettersUseCase,
  SyncMailboxUseCase,
  UpdatePrintStatusUseCase,
} from '../application/use-cases/index.js';
import { AppError } from '../domain/errors.js';
import { ContentAssignmentStrategy } from '../domain/services/assignment.js';
import { AttachmentProcessor } from '../infrastructure/attachments/AttachmentProcessor.js';
import { SystemClock } from '../infrastructure/clock/SystemClock.js';
import { PinoLogger } from '../infrastructure/logging/PinoLogger.js';
import { DemoMailSource } from '../infrastructure/persistence/json/DemoMailSource.js';
import { createJsonPersistence } from '../infrastructure/persistence/json/createJsonPersistence.js';
import { DEMO_PARTICIPANTS } from '../infrastructure/persistence/json/demo/demoData.js';
import { readParticipantsFile } from '../infrastructure/persistence/json/participantsFile.js';
import { purgeData } from '../infrastructure/maintenance/purgeData.js';
import { getOrCreateActiveRetreat } from '../modules/participants/application/activeRetreat.js';
import { ParticipantRecordRepositoryPort, RetreatRepositoryPort } from '../modules/participants/application/ports.js';
import { ParticipantsUseCase } from '../modules/participants/application/ParticipantsUseCase.js';
import { RetreatUseCase } from '../modules/participants/application/RetreatUseCase.js';
import { AccommodationUseCase } from '../modules/accommodation/application/AccommodationUseCase.js';
import { AssignmentRepositoryPort, PlaceRepositoryPort } from '../modules/accommodation/application/ports.js';
import { createMongoPersistence } from '../infrastructure/persistence/mongo/createMongoPersistence.js';
import { FileExportStorage } from '../infrastructure/rendering/FileExportStorage.js';
import { AttachmentsPdfRenderer } from '../infrastructure/rendering/AttachmentsPdfRenderer.js';
import { HtmlPacketRenderer } from '../infrastructure/rendering/HtmlPacketRenderer.js';
import { JsonRenderer } from '../infrastructure/rendering/JsonRenderer.js';
import { TxtRenderer } from '../infrastructure/rendering/TxtRenderer.js';
import { loadConfig } from './config.js';

/**
 * @typedef {import('../infrastructure/persistence/json/createJsonPersistence.js').PersistenceAdapters} PersistenceAdapters
 *
 * @typedef {Object} PersistenceContext
 * @property {import('./config.js').AppConfig} config
 * @property {import('../application/ports/ClockPort.js').ClockPort} clock
 * @property {import('../application/ports/LoggerPort.js').LoggerPort} logger
 *
 * @typedef {Object} MailSourceContext
 * @property {import('./config.js').AppConfig} config
 * @property {import('../application/ports/ClockPort.js').ClockPort} clock
 * @property {import('../application/ports/LoggerPort.js').LoggerPort} logger
 */

/**
 * Persistence factories by `PERSISTENCE` value. Demo mode always uses in-memory stores.
 * @type {Map<string, (context: PersistenceContext) => Promise<PersistenceAdapters>>}
 */
const persistenceFactories = new Map([
  [
    'mongo',
    async ({ config, clock, logger }) =>
      createMongoPersistence({
        uri: config.mongo.uri,
        dbName: config.mongo.db,
        clock,
        logger,
        runsTtlDays: config.sync.runsTtlDays,
      }),
  ],
  [
    'json',
    async ({ config, clock }) =>
      createJsonPersistence({ directory: join(config.dataDir, 'db'), clock, runsTtlDays: config.sync.runsTtlDays }),
  ],
]);

/**
 * Mail source factories by kind ('demo' in demo mode, 'gmail' otherwise).
 * @type {Map<string, (context: MailSourceContext) => Promise<import('../application/ports/MailSourcePort.js').MailSourcePort>>}
 */
const mailSourceFactories = new Map([
  ['demo', async () => new DemoMailSource()],
  [
    'gmail',
    async ({ config, logger }) => {
      // Loaded lazily: googleapis is large and not needed in demo mode or tests.
      const { createGmailMailSource } = await import('../infrastructure/gmail/createGmailMailSource.js');
      return createGmailMailSource({ config, logger });
    },
  ],
]);

/**
 * Identifies the mail selection (Gmail query, label and start date, or demo mode). The sync
 * remembers it with its cursor and runs a full listing when it changes.
 * @param {import('./config.js').AppConfig} config
 * @returns {string}
 */
export function mailSelectionKey(config) {
  if (config.demoMode) return 'demo';
  const { query, labelId, startDate } = config.gmail;
  return `gmail:${JSON.stringify({ query, labelId, startDate })}`;
}

/**
 * Registers (or replaces) a persistence adapter factory.
 * @param {string} kind
 * @param {(context: PersistenceContext) => Promise<PersistenceAdapters>} factory
 */
export function registerPersistenceFactory(kind, factory) {
  persistenceFactories.set(kind, factory);
}

/**
 * Registers (or replaces) a mail source factory.
 * @param {string} kind
 * @param {(context: MailSourceContext) => Promise<import('../application/ports/MailSourcePort.js').MailSourcePort>} factory
 */
export function registerMailSourceFactory(kind, factory) {
  mailSourceFactories.set(kind, factory);
}

/**
 * @typedef {Object} ContainerOverrides
 * @property {import('../application/ports/LoggerPort.js').LoggerPort} [logger]
 * @property {import('../application/ports/ClockPort.js').ClockPort} [clock]
 * @property {() => string} [idGenerator]
 * @property {import('../application/ports/MailSourcePort.js').MailSourcePort} [mailSource]
 * @property {PersistenceAdapters} [persistence]
 * @property {import('../domain/entities/Participant.js').Participant[]} [participants]  Seeded at startup.
 * @property {import('../application/ports/ExportRendererPort.js').ExportRendererPort[]} [renderers]
 * @property {import('../application/ports/ExportStoragePort.js').ExportStoragePort} [exportStorage]
 * @property {import('../application/ports/AttachmentProcessorPort.js').AttachmentProcessorPort | null} [attachmentProcessor]
 *           null disables attachments; omitted = built from the mail source when it can fetch attachments.
 */

/**
 * @param {{
 *   config?: import('./config.js').AppConfig,
 *   role?: 'web' | 'cli',
 *   overrides?: ContainerOverrides,
 * }} [options]
 */
export async function createContainer({ config = loadConfig(), role = 'cli', overrides = {} } = {}) {
  const logger = LoggerPort.assert(
    overrides.logger ??
      PinoLogger.create({
        level: config.logLevel,
        destination: 'stdout',
        bindings: { role },
      }),
  );
  const clock = ClockPort.assert(overrides.clock ?? new SystemClock());
  const idGenerator = overrides.idGenerator ?? randomUUID;

  // The mail source is created first: if it is not configured, no database connection is opened.
  const mailSource = MailSourcePort.assert(overrides.mailSource ?? (await createMailSource({ config, clock, logger })));

  // Attachments are downloaded on demand from the mail source when it supports it.
  const attachmentProcessor =
    overrides.attachmentProcessor !== undefined
      ? overrides.attachmentProcessor && AttachmentProcessorPort.assert(overrides.attachmentProcessor)
      : typeof (/** @type {any} */ (mailSource).fetchAttachment) === 'function'
        ? new AttachmentProcessor({
            source: AttachmentSourcePort.assert(/** @type {any} */ (mailSource)),
            cacheDir: config.cacheDir,
            maxBytes: config.maxAttachmentMb * 1024 * 1024,
            logger,
          })
        : null;

  const renderers = (
    overrides.renderers ?? [
      new HtmlPacketRenderer({ attachments: attachmentProcessor }),
      new TxtRenderer(),
      new JsonRenderer(),
      new AttachmentsPdfRenderer({ attachments: attachmentProcessor }),
    ]
  ).map((renderer) => ExportRendererPort.assert(renderer));
  const htmlRenderer = renderers.find((renderer) => renderer.format === 'html') ?? new HtmlPacketRenderer({ attachments: attachmentProcessor });
  const exportStorage = ExportStoragePort.assert(
    overrides.exportStorage ?? new FileExportStorage({ exportDir: config.exportDir }),
  );

  const persistence = overrides.persistence ?? (await createPersistenceAdapters({ config, clock, logger }));
  const letterStore = LetterStoreRepositoryPort.assert(persistence.letterStore);
  const syncStateRepository = SyncStateRepositoryPort.assert(persistence.syncStateRepository);
  const participantRepository = ParticipantRepositoryPort.assert(persistence.participantRepository);
  const printStatusRepository = PrintStatusRepositoryPort.assert(persistence.printStatusRepository);
  const overrideRepository = AssignmentOverrideRepositoryPort.assert(persistence.overrideRepository);
  const participantRecords = ParticipantRecordRepositoryPort.assert(persistence.participantRecords);
  const retreats = RetreatRepositoryPort.assert(persistence.retreats);
  const rooms = PlaceRepositoryPort.assert(persistence.rooms);
  const tables = PlaceRepositoryPort.assert(persistence.tables);
  const roomAssignments = AssignmentRepositoryPort.assert(persistence.roomAssignments);
  const tableAssignments = AssignmentRepositoryPort.assert(persistence.tableAssignments);

  try {
    await prepareRetreat({ config, overrides, persistence, participantRepository, participantRecords, retreats, letterStore, clock, logger });
  } catch (error) {
    await persistence.close().catch(() => {});
    throw error;
  }

  const assignmentStrategy = new ContentAssignmentStrategy({
    minConfidence: config.assignment.minConfidence,
    bodyScanChars: config.assignment.bodyScanChars,
  });

  const recomputeAssignments = new RecomputeAssignmentsUseCase({
    letterStore,
    overrideRepository,
    participantRepository,
    assignmentStrategy,
    logger,
  });
  // Retreat ids are UUIDs of their own (the injectable idGenerator names sync runs).
  const activeRetreat = () => getOrCreateActiveRetreat(retreats, { now: clock.now() });
  /** Letters assigned to each participant (active letters only). */
  const letterUsage = {
    async countByParticipant() {
      const counts = new Map();
      for (const letter of await letterStore.findAll()) {
        for (const id of letter.assignment.participantIds) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      return counts;
    },
  };

  // Accommodation module (rooms and tables): reads participants through their repository.
  const accommodation = new AccommodationUseCase({
    rooms,
    tables,
    roomAssignments,
    tableAssignments,
    participants: { findByRetreat: (retreatId) => participantRecords.findByRetreat(retreatId) },
    retreats,
    clock,
    logger,
  });

  const preparePrintView = new PreparePrintViewUseCase({
    participantRepository,
    letterStore,
    clock,
    timeZone: config.timeZone,
  });

  const useCases = Object.freeze({
    getDashboardOverview: new GetDashboardOverviewUseCase({
      participantRepository,
      letterStore,
      printStatusRepository,
      syncStateRepository,
      clock,
      minIntervalSeconds: config.sync.minIntervalSeconds,
    }),
    groupParticipantLetters: new GroupParticipantLettersUseCase({
      participantRepository,
      letterStore,
      printStatusRepository,
      timeZone: config.timeZone,
    }),
    preparePrintView,
    exportBatchLetters: new ExportBatchLettersUseCase({
      preparePrintView,
      renderers,
      exportStorage,
      printStatusRepository,
      clock,
      logger,
      timeZone: config.timeZone,
    }),
    updatePrintStatus: new UpdatePrintStatusUseCase({ participantRepository, printStatusRepository, clock }),
    searchRawLetters: new SearchRawLettersUseCase({ letterStore, participantRepository }),
    reviewAssignment: new ReviewAssignmentUseCase({
      letterStore,
      overrideRepository,
      participantRepository,
      assignmentStrategy,
      clock,
    }),
    syncMailbox: new SyncMailboxUseCase({
      mailSource,
      letterStore,
      syncStateRepository,
      overrideRepository,
      participantRepository,
      assignmentStrategy,
      clock,
      logger,
      idGenerator,
      ownerPrefix: `${role}@${hostname()}:${process.pid}`,
      minIntervalSeconds: config.sync.minIntervalSeconds,
      lockTtlSeconds: config.sync.lockTtlSeconds,
      selectionKey: mailSelectionKey(config),
      activeRetreat,
    }),
    getSyncStatus: new GetSyncStatusUseCase({
      syncStateRepository,
      participantRepository,
      clock,
      minIntervalSeconds: config.sync.minIntervalSeconds,
    }),
    getNewLetters: new GetNewLettersUseCase({ letterStore, participantRepository }),
    markLettersSeen: new MarkLettersSeenUseCase({ letterStore, participantRepository }),
    recomputeAssignments,
    // Participants module: the single source of participants of the retreat.
    participants: new ParticipantsUseCase({
      participantRecords,
      retreats,
      letterUsage,
      recomputeAssignments,
      clock,
      logger,
      timeZone: config.timeZone,
      onParticipantLeft: (participantId) => accommodation.releaseParticipant(participantId),
    }),
    accommodation,
    retreat: new RetreatUseCase({
      retreats,
      participantRecords,
      // Single active retreat: every letter, manual decision, print status and sync record
      // belongs to it, so closing it deletes them all, plus local files with personal data.
      purgeRetreatData: async (retreatId) => {
        await purgeData({ persistence, directories: [config.cacheDir, config.exportDir], projectRoot: config.projectRoot });
        await accommodation.deleteRetreatData(retreatId);
        await participantRecords.deleteByRetreat(retreatId);
      },
      countLetters: async () => (await letterStore.findAll({ includeDeleted: true })).length,
      clock,
      logger,
      retentionDays: config.retreat.retentionDays,
      timeZone: config.timeZone,
    }),
    getAttachment: new GetAttachmentUseCase({ letterStore, attachmentProcessor }),
  });

  logger.info(
    {
      persistence: persistence.kind,
      mailSource: config.demoMode ? 'demo' : 'gmail',
      timeZone: config.timeZone,
      exportFormats: renderers.map((renderer) => renderer.format),
    },
    'Container ready',
  );

  return Object.freeze({
    config,
    role,
    logger,
    clock,
    mailSource,
    assignmentStrategy,
    exportStorage,
    htmlRenderer,
    attachmentProcessor,
    repositories: Object.freeze({
      letterStore,
      syncStateRepository,
      participantRepository,
      participantRecords,
      retreats,
      rooms,
      tables,
      roomAssignments,
      tableAssignments,
      printStatusRepository,
      overrideRepository,
    }),
    useCases,
    async close() {
      await persistence.close();
    },
  });
}

/**
 * Persistence adapters for the configuration (in-memory in demo mode). Also used by
 * maintenance scripts such as `npm run db:purge`, which do not need a mail source.
 * @param {PersistenceContext} context
 * @returns {Promise<PersistenceAdapters>}
 */
export async function createPersistenceAdapters({ config, clock, logger }) {
  if (config.demoMode) {
    return createJsonPersistence({ directory: null, clock, runsTtlDays: config.sync.runsTtlDays });
  }
  const factory = persistenceFactories.get(config.persistence);
  if (!factory) {
    throw new AppError('CONFIG_ERROR', 500, undefined, {
      variable: 'PERSISTENCE',
      reason: `no adapter registered for "${config.persistence}" (available: ${[...persistenceFactories.keys()].join(', ')})`,
    });
  }
  return factory({ config, clock, logger });
}

/**
 * @param {MailSourceContext} context
 */
async function createMailSource({ config, clock, logger }) {
  const kind = config.demoMode ? 'demo' : 'gmail';
  const factory = mailSourceFactories.get(kind);
  if (!factory) {
    throw new AppError('MAIL_SOURCE_NOT_CONFIGURED', 503, undefined, {
      reason: `no mail source registered for "${kind}" (available: ${[...mailSourceFactories.keys()].join(', ')})`,
    });
  }
  return factory({ config, clock, logger });
}

/**
 * Startup preparation of the active retreat (idempotent, safe for several processes):
 * 1. the active retreat exists (the first one is created on the first run);
 * 2. letters and participants stored by older versions are attached to it, keeping their ids;
 * 3. participants are seeded only in demo mode / tests, or imported ONCE from
 *    PARTICIPANTS_FILE when the retreat has none. Afterwards the participants module is the
 *    single source: the file is never read again (nor overwrites dashboard changes).
 * @param {{
 *   config: import('./config.js').AppConfig,
 *   overrides: ContainerOverrides,
 *   persistence: PersistenceAdapters,
 *   participantRepository: import('../application/ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
 *   participantRecords: import('../modules/participants/application/ports.js').ParticipantRecordRepositoryPort,
 *   retreats: import('../modules/participants/application/ports.js').RetreatRepositoryPort,
 *   letterStore: import('../application/ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
 *   clock: import('../application/ports/ClockPort.js').ClockPort,
 *   logger: import('../application/ports/LoggerPort.js').LoggerPort,
 * }} context
 */
async function prepareRetreat({ config, overrides, participantRepository, participantRecords, retreats, letterStore, clock, logger }) {
  const retreat = await getOrCreateActiveRetreat(retreats, { now: clock.now() });
  const stampedLetters = await letterStore.assignRetreat(retreat.id);
  const adopted = await participantRecords.adoptLegacy(retreat.id, clock.now());
  if (stampedLetters > 0 || adopted > 0) {
    logger.info({ retreatId: retreat.id, letters: stampedLetters, participants: adopted }, 'Data from a previous version attached to the active retreat');
  }

  if (overrides.participants) {
    await participantRepository.replaceAll(overrides.participants);
    return;
  }
  if (config.demoMode) {
    await participantRepository.replaceAll(/** @type {any} */ (DEMO_PARTICIPANTS));
    return;
  }
  const existing = await participantRecords.findByRetreat(retreat.id);
  if (existing.length > 0) return;
  const fromFile = await readParticipantsFile(config.participantsFile);
  if (fromFile && fromFile.length > 0) {
    await participantRepository.replaceAll(fromFile);
    logger.info({ count: fromFile.length }, 'Participants imported once from PARTICIPANTS_FILE (from now on they are managed in the dashboard)');
  }
}
