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
  ParticipantListFilePort,
  ParticipantRepositoryPort,
  PrintStatusRepositoryPort,
  SyncStateRepositoryPort,
} from '../application/ports/index.js';
import {
  AddParticipantUseCase,
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
import { ParticipantsJsonFile, readParticipantsFile } from '../infrastructure/persistence/json/participantsFile.js';
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
 * @property {import('../application/ports/ParticipantListFilePort.js').ParticipantListFilePort | null} [participantFile]  Where added participants are saved.
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

  try {
    await seedParticipants({ config, overrides, participantRepository, logger });
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
  // Participants added from the dashboard are written back to PARTICIPANTS_FILE (the list is
  // reloaded from it at startup). Demo mode and injected lists have no file.
  const participantFile =
    overrides.participantFile !== undefined
      ? overrides.participantFile && ParticipantListFilePort.assert(overrides.participantFile)
      : config.demoMode || overrides.participants
        ? null
        : new ParticipantsJsonFile(config.participantsFile);

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
    addParticipant: new AddParticipantUseCase({
      participantRepository,
      participantFile,
      recomputeAssignments,
      logger,
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
 * Participants come from (in order): explicit override, the demo dataset in demo mode, or
 * PARTICIPANTS_FILE when it exists. Otherwise the stored list is kept as is.
 * @param {{
 *   config: import('./config.js').AppConfig,
 *   overrides: ContainerOverrides,
 *   participantRepository: import('../application/ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
 *   logger: import('../application/ports/LoggerPort.js').LoggerPort,
 * }} context
 */
async function seedParticipants({ config, overrides, participantRepository, logger }) {
  if (overrides.participants) {
    await participantRepository.replaceAll(overrides.participants);
    return;
  }
  if (config.demoMode) {
    await participantRepository.replaceAll(/** @type {any} */ (DEMO_PARTICIPANTS));
    return;
  }
  const fromFile = await readParticipantsFile(config.participantsFile);
  if (fromFile) {
    await participantRepository.replaceAll(fromFile);
    logger.info({ count: fromFile.length }, 'Participants loaded from PARTICIPANTS_FILE');
  } else {
    logger.warn('PARTICIPANTS_FILE not found; keeping the stored participant list');
  }
}
