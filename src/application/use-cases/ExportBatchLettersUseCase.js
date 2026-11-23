import { DEFAULTS } from '../../domain/constants.js';
import { markLettersPrinted } from '../../domain/entities/PrintStatus.js';
import { AppError } from '../../domain/errors.js';
import { zonedParts } from '../../domain/services/time.js';

/**
 * @param {number} value
 * @returns {string}
 */
function pad(value) {
  return String(value).padStart(2, '0');
}

/**
 * Server-side filename built only from slugs and a local timestamp
 * (e.g. "cartas_juan-perez_20261121-093000.html", "cartas_lote-12_20261121-093000.txt").
 * @param {import('../../domain/entities/BatchExportPayload.js').BatchExportPayload} payload
 * @param {string} extension
 * @param {Date} now
 * @param {string} timeZone
 * @param {string} [prefix]  "cartas" for letter packets, "adjuntos" for the merged PDF.
 * @returns {string}
 */
export function buildExportFilename(payload, extension, now, timeZone, prefix = 'cartas') {
  const p = zonedParts(now, timeZone);
  const stamp = `${p.year}${pad(p.month)}${pad(p.day)}-${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;
  const scope = payload.sections.length === 1 ? payload.sections[0].participant.id : `lote-${payload.sections.length}`;
  return `${prefix}_${scope}_${stamp}.${extension}`;
}

/**
 * Renders a batch (HTML packet / TXT / JSON / merged attachments PDF) and stores it under EXPORT_DIR.
 * Optionally marks the exported participants as printed (the UI asks for confirmation).
 */
export class ExportBatchLettersUseCase {
  #preparePrintView;
  #renderers;
  #storage;
  #printStatuses;
  #clock;
  #timeZone;
  #changes;
  #logger;

  /**
   * @param {{
   *   preparePrintView: import('./PreparePrintViewUseCase.js').PreparePrintViewUseCase,
   *   renderers: ReadonlyArray<import('../ports/ExportRendererPort.js').ExportRendererPort>,
   *   exportStorage: import('../ports/ExportStoragePort.js').ExportStoragePort,
   *   printStatusRepository: import('../ports/PrintStatusRepositoryPort.js').PrintStatusRepositoryPort,
   *   clock: import('../ports/ClockPort.js').ClockPort,
   *   logger: import('../ports/LoggerPort.js').LoggerPort,
   *   changes?: import('../services/MailChangeRecorder.js').MailChangeRecorder | null,
   *   timeZone?: string,
   * }} deps
   */
  constructor({ preparePrintView, renderers, exportStorage, printStatusRepository, clock, logger, timeZone, changes = null }) {
    this.#changes = changes;
    this.#preparePrintView = preparePrintView;
    this.#renderers = new Map(renderers.map((renderer) => [renderer.format, renderer]));
    this.#storage = exportStorage;
    this.#printStatuses = printStatusRepository;
    this.#clock = clock;
    this.#logger = logger;
    this.#timeZone = timeZone ?? DEFAULTS.TIME_ZONE;
  }

  /** Formats with a registered renderer. */
  get formats() {
    return [...this.#renderers.keys()];
  }

  /**
   * @param {{
   *   participantIds: string[],
   *   format: string,
   *   markAsPrinted?: boolean,
   *   includeAttachments?: boolean,
   *   originalFormat?: boolean,
   *   afterDate?: string | null,
   *   actor?: string,
   * }} input
   */
  async execute(input) {
    const format = typeof input?.format === 'string' ? input.format : '';
    const renderer = this.#renderers.get(format);
    if (!renderer) {
      throw new AppError('UNSUPPORTED_EXPORT_FORMAT', 400, undefined, { format, available: this.formats });
    }

    const payload = await this.#preparePrintView.execute({
      participantIds: input.participantIds,
      afterDate: input.afterDate ?? null,
    });
    const content = await renderer.render(payload, {
      includeAttachments: input.includeAttachments !== false,
      originalFormat: input.originalFormat !== false,
    });
    const now = this.#clock.now();
    const filename = buildExportFilename(payload, renderer.extension, now, this.#timeZone, renderer.filePrefix ?? 'cartas');
    const { filePath } = await this.#storage.save(filename, content);

    const participantIds = payload.sections.map((section) => section.participant.id);
    const markAsPrinted = input.markAsPrinted === true;
    if (markAsPrinted) {
      // Only the exported letters become printed (the rest keep their state).
      const current = new Map((await this.#printStatuses.findAll()).map((s) => [s.participantId, s]));
      await this.#printStatuses.saveMany(
        payload.sections.map((section) =>
          markLettersPrinted(current.get(section.participant.id), section.participant.id, section.letters.map((l) => l.messageId), now, section.letters),
        ),
      );
      await this.#changes?.record({
        actor: input.actor,
        action: 'print.marked',
        messageIds: payload.sections.flatMap((section) => section.letters.map((l) => l.messageId)),
        participantIds,
        details: { via: 'export', format },
      });
    }

    this.#logger.info(
      { format, participantCount: payload.participantCount, letterCount: payload.letterCount, markAsPrinted },
      'Batch export written',
    );

    return {
      filePath,
      filename,
      format,
      mimeType: renderer.mimeType,
      participantIds,
      participantCount: payload.participantCount,
      letterCount: payload.letterCount,
      uniqueLetterCount: payload.uniqueLetterCount,
      markedAsPrinted: markAsPrinted,
    };
  }
}
