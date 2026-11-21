/**
 * Single composition root (manual dependency injection). The web and MCP entrypoints build
 * their container here and share the same use cases and database.
 */
import { hostname } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  AssignmentOverrideRepositoryPort,
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
import { SystemClock } from '../infrastructure/clock/SystemClock.js';
import { PinoLogger } from '../infrastructure/logging/PinoLogger.js';
import { DemoMailSource } from '../infrastructure/persistence/json/DemoMailSource.js';
import { createJsonPersistence } from '../infrastructure/persistence/json/createJsonPersistence.js';
import { DEMO_PARTICIPANTS } from '../infrastructure/persistence/json/demo/demoData.js';
import { readParticipantsFile } from '../infrastructure/persistence/json/participantsFile.js';
import { createMongoPersistence } from '../infrastructure/persistence/mongo/createMongoPersistence.js';
import { FileExportStorage } from '../infrastructure/rendering/FileExportStorage.js';
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
const mailSourceFactories = new Map([['demo', async () => new DemoMailSource()]]);

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
 */

/**
 * @param {{
 *   config?: import('./config.js').AppConfig,
 *   role?: 'web' | 'mcp' | 'cli',
 *   overrides?: ContainerOverrides,
 * }} [options]
 */
export async function createContainer({ config = loadConfig(), role = 'cli', overrides = {} } = {}) {
  const logger = LoggerPort.assert(
    overrides.logger ??
      PinoLogger.create({
        level: config.logLevel,
        destination: role === 'mcp' ? 'stderr' : 'stdout',
        bindings: { role },
      }),
  );
  const clock = ClockPort.assert(overrides.clock ?? new SystemClock());
  const idGenerator = overrides.idGenerator ?? randomUUID;

  // The mail source is created first: if it is not configured, no database connection is opened.
  const mailSource = MailSourcePort.assert(overrides.mailSource ?? (await createMailSource({ config, clock, logger })));
  const renderers = (overrides.renderers ?? [new HtmlPacketRenderer(), new TxtRenderer(), new JsonRenderer()]).map(
    (renderer) => ExportRendererPort.assert(renderer),
  );
  const exportStorage = ExportStoragePort.assert(
    overrides.exportStorage ?? new FileExportStorage({ exportDir: config.exportDir }),
  );

  const persistence = overrides.persistence ?? (await createPersistence({ config, clock, logger }));
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
    }),
    getSyncStatus: new GetSyncStatusUseCase({
      syncStateRepository,
      participantRepository,
      clock,
      minIntervalSeconds: config.sync.minIntervalSeconds,
    }),
    getNewLetters: new GetNewLettersUseCase({ letterStore, participantRepository }),
    markLettersSeen: new MarkLettersSeenUseCase({ letterStore, participantRepository }),
    recomputeAssignments: new RecomputeAssignmentsUseCase({
      letterStore,
      overrideRepository,
      participantRepository,
      assignmentStrategy,
      logger,
    }),
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
 * @param {PersistenceContext} context
 * @returns {Promise<PersistenceAdapters>}
 */
async function createPersistence({ config, clock, logger }) {
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
