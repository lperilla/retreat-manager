import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import express from 'express';

import { describeError } from '../../../application/services/errorDescription.js';
import { normalizeActor } from '../../../application/services/MailChangeRecorder.js';
import { loadConfig } from '../../../composition/config.js';
import { AppError } from '../../../domain/errors.js';
import {
  SETTING_FIELDS,
  readSettingsEnv,
  settingsFromConfig,
  settingsInputToEnv,
  settingsPath,
  writeSettingsEnv,
} from '../../settings/settingsFile.js';

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function queryString(value) {
  if (Array.isArray(value)) return queryString(value[0]);
  return typeof value === 'string' ? value : undefined;
}

/**
 * JSON API consumed by the dashboard. All reads come from the local store; only
 * POST /api/sync reaches the mail source (in the background).
 * @param {{
 *   runtime: import('../WebRuntime.js').WebRuntime,
 *   limiters: { sync: import('express').RequestHandler, exports: import('express').RequestHandler, attachments: import('express').RequestHandler },
 * }} options
 * @returns {import('express').Router}
 */
export function createApiRouter({ runtime, limiters }) {
  const router = express.Router();
  const useCases = () => runtime.container.useCases;
  // Who is making the change: header sent by the dashboard (there is one shared access token, no accounts).
  const actorOf = (/** @type {import('express').Request} */ req) => normalizeActor(req.get('x-actor') ?? req.body?.actor);

  router.get('/app-info', (_req, res) => {
    res.json(runtime.info());
  });

  router.post('/demo/enable', async (_req, res) => {
    await runtime.enableDemo();
    res.json(runtime.info());
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, setupRequired: runtime.setupRequired });
  });

  // Dashboard and participants -------------------------------------------------
  router.get('/dashboard', async (req, res) => {
    res.json(
      await useCases().getDashboardOverview.execute({
        search: queryString(req.query.search),
        filter: queryString(req.query.filter),
        sortBy: queryString(req.query.sortBy),
      }),
    );
  });

  router.get('/participants/:participantId/letters', async (req, res) => {
    res.json(
      await useCases().groupParticipantLetters.execute({
        participantId: req.params.participantId,
        afterDate: queryString(req.query.afterDate) ?? null,
      }),
    );
  });

  router.post('/print-status', async (req, res) => {
    res.json(await useCases().updatePrintStatus.execute({ participantIds: req.body?.participantIds, status: req.body?.status, messageIds: req.body?.messageIds, actor: actorOf(req) }));
  });

  // Letters ---------------------------------------------------------------------
  router.get('/letters/search', async (req, res) => {
    res.json(
      await useCases().searchRawLetters.execute({
        query: queryString(req.query.q) ?? '',
        limit: queryString(req.query.limit),
      }),
    );
  });

  router.get('/letters/new', async (req, res) => {
    res.json(await useCases().getNewLetters.execute({ participantId: queryString(req.query.participantId) ?? null }));
  });

  router.post('/letters/seen', async (req, res) => {
    res.json(
      await useCases().markLettersSeen.execute({
        participantId: req.body?.participantId ?? null,
        messageIds: req.body?.messageIds ?? null,
        seen: req.body?.seen !== false,
      }),
    );
  });

  // Attachments (downloaded on demand, cached on disk) --------------------------
  router.get('/letters/:messageId/attachments/:index', limiters.attachments, async (req, res) => {
    const content = await useCases().getAttachment.getContent({
      messageId: req.params.messageId,
      index: req.params.index,
      variant: queryString(req.query.variant) ?? 'original',
    });
    const download = queryString(req.query.download) === '1' || content.mimeType === 'application/octet-stream' || content.kind === 'docx';
    res.setHeader('Content-Type', content.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'; sandbox");
    if (content.mimeType === 'application/pdf') {
      // Allow the in-app PDF preview (same-origin iframe); PDF viewers do not run in a sandbox.
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'");
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    if (download) res.attachment(content.filename);
    else res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(content.filename)}`);
    // Set last: res.attachment() would infer a type from the extension (never trust it).
    res.setHeader('Content-Type', content.mimeType);
    res.end(Buffer.from(content.data));
  });

  router.get('/letters/:messageId/attachments/:index/text', limiters.attachments, async (req, res) => {
    res.json(await useCases().getAttachment.extractText({ messageId: req.params.messageId, index: req.params.index }));
  });

  // Review and manual assignment ------------------------------------------------
  router.get('/review', async (_req, res) => {
    res.json(await useCases().reviewAssignment.listQueue());
  });

  router.post('/review/:messageId/assign', async (req, res) => {
    res.json(
      await useCases().reviewAssignment.assign({
        messageId: req.params.messageId,
        participantIds: req.body?.participantIds,
        actor: actorOf(req),
      }),
    );
  });

  router.post('/review/:messageId/unassign', async (req, res) => {
    res.json(await useCases().reviewAssignment.leaveUnassigned({ messageId: req.params.messageId, actor: actorOf(req) }));
  });

  router.post('/review/:messageId/reset', async (req, res) => {
    res.json(await useCases().reviewAssignment.resetToAutomatic({ messageId: req.params.messageId, actor: actorOf(req) }));
  });

  router.post('/assignments/recompute', async (_req, res) => {
    res.json(await useCases().recomputeAssignments.execute());
  });

  // Settings (Configuración) -----------------------------------------------------
  /** What the screen needs: effective values plus a warning when the Gmail token lacks the label permission. */
  const settingsView = async () => {
    const config = runtime.config;
    let tokenHasLabelScope = null;
    try {
      const token = JSON.parse(await readFile(config.gmail.tokenPath, 'utf8'));
      tokenHasLabelScope = String(token.scope ?? '').split(/\s+/).includes('https://www.googleapis.com/auth/gmail.modify');
    } catch {
      // No token yet (demo or not authorized): nothing to report.
    }
    const demoMode = Boolean(runtime.containerOrNull?.config.demoMode);
    const values = settingsFromConfig(config);
    const started = settingsFromConfig(runtime.startConfig);
    // Changes that only take effect after a restart: always the automatic interval, and everything in demo mode.
    const restartPending = SETTING_FIELDS.filter((field) => (field.restart || demoMode) && started[field.key] !== values[field.key]).map((field) => field.key);
    return {
      values,
      defaults: settingsFromConfig(loadConfig({ TZ: config.timeZone }, { rootDir: config.projectRoot })),
      restartRequired: SETTING_FIELDS.filter((field) => field.restart).map((field) => field.key),
      restartPending,
      canRestart: runtime.canRestart,
      demoMode,
      tokenHasLabelScope,
    };
  };

  router.get('/settings', async (_req, res) => {
    res.json(await settingsView());
  });

  router.post('/restart', limiters.sync, async (req, res) => {
    if (!runtime.canRestart) throw new AppError('RESTART_UNAVAILABLE', 409);
    runtime.logger.info({ actor: actorOf(req) }, 'Restart requested from the dashboard');
    res.status(202).json({ restarting: true });
    // Restart only after the answer has been sent.
    res.on('finish', () => setTimeout(() => runtime.requestRestart(), 300));
  });

  router.put('/settings', async (req, res) => {
    const file = settingsPath(runtime.config.dataDir);
    const saved = { ...readSettingsEnv(file), ...settingsInputToEnv(req.body?.values ?? {}) };
    // The same rules as the environment: an invalid value is rejected before anything is saved.
    const current = runtime.config;
    let validated;
    try {
      validated = loadConfig({ TZ: current.timeZone, ...saved }, { rootDir: current.projectRoot });
    } catch (error) {
      const details = /** @type {{ details?: { variable?: string, reason?: string } }} */ (error)?.details;
      throw new AppError('VALIDATION_ERROR', 400, `Configuración no válida${details?.variable ? ` (${details.variable}: ${details.reason})` : ''}.`);
    }
    // Only the editable fields change; everything else (paths, database, access code) stays as started.
    const next = Object.freeze({
      ...current,
      gmail: Object.freeze({
        ...current.gmail,
        query: validated.gmail.query,
        labelId: validated.gmail.labelId,
        startDate: validated.gmail.startDate,
        startAt: validated.gmail.startAt,
        concurrency: validated.gmail.concurrency,
        requestsPerSecond: validated.gmail.requestsPerSecond,
        labels: validated.gmail.labels,
      }),
      sync: Object.freeze({ ...current.sync, intervalMinutes: validated.sync.intervalMinutes }),
    });
    const { reloaded } = await runtime.reload(next);
    await writeSettingsEnv(file, saved);
    runtime.logger.info({ actor: actorOf(req), reloaded }, 'Settings saved from the dashboard');
    // New label names (or labels just enabled): replace the old labels in Gmail in the background,
    // removing them from the messages and deleting the ones nobody uses any more.
    const before = current.gmail.labels;
    const after = next.gmail.labels;
    const labelsChanged =
      after.enabled && (!before.enabled || before.participantPrefix !== after.participantPrefix || before.printedLabel !== after.printedLabel);
    const labelsUpdating = reloaded && labelsChanged;
    if (labelsUpdating) {
      runtime.container.useCases.syncMailLabels
        .execute({ actor: actorOf(req) })
        .then((summary) => runtime.logger.info({ applied: summary.applied, deletedLabels: summary.deletedLabels }, 'Gmail labels updated after a settings change'))
        .catch((error) => runtime.logger.warn({ err: describeError(error) }, 'Gmail labels not updated after a settings change'));
    }
    res.json({ ...(await settingsView()), reloaded, labelsUpdating });
  });

  // Mailbox: letters with labels, print state and Gmail trace --------------------
  router.get('/mail', async (req, res) => {
    res.json(
      await useCases().listMail.execute({
        participantId: queryString(req.query.participantId),
        label: queryString(req.query.label),
        sender: queryString(req.query.sender),
        from: queryString(req.query.from),
        to: queryString(req.query.to),
        printed: queryString(req.query.printed),
        hasAttachments: queryString(req.query.hasAttachments),
        limit: queryString(req.query.limit),
        offset: queryString(req.query.offset),
      }),
    );
  });

  router.post('/mail/:messageId/printed', async (req, res) => {
    res.json(await useCases().updatePrintStatus.setLetterPrinted({ messageId: req.params.messageId, printed: req.body?.printed, actor: actorOf(req) }));
  });

  router.get('/mail/audit', async (req, res) => {
    const entries = await runtime.container.repositories.auditLogRepository.find({
      messageId: queryString(req.query.messageId) ?? null,
      actor: queryString(req.query.actor) ?? null,
      limit: Number.parseInt(queryString(req.query.limit) ?? '100', 10) || 100,
    });
    res.json({ entries: entries.map((e) => ({ ...e, at: e.at.toISOString() })) });
  });

  router.get('/mail/labels/status', async (_req, res) => {
    res.json(await useCases().syncMailLabels.status());
  });

  router.post('/mail/labels/sync', limiters.sync, async (req, res) => {
    const messageIds = Array.isArray(req.body?.messageIds) ? req.body.messageIds.filter((id) => typeof id === 'string') : null;
    res.json(await useCases().syncMailLabels.execute({ actor: actorOf(req), messageIds, force: req.body?.force === true }));
  });

  router.post('/mail/labels/reset', limiters.sync, async (req, res) => {
    res.json(await useCases().syncMailLabels.reset({ actor: actorOf(req) }));
  });

  // Synchronization ---------------------------------------------------------------
  router.post('/sync', limiters.sync, async (req, res) => {
    const started = await useCases().syncMailbox.start({ mode: req.body?.mode ?? 'incremental' });
    started.completion.catch(() => {});
    res.status(202).json({
      accepted: true,
      syncRunId: started.syncRunId,
      mode: started.requestedMode,
      startedAt: started.startedAt.toISOString(),
    });
  });

  router.get('/sync/status', async (_req, res) => {
    res.json(await useCases().getSyncStatus.execute());
  });

  router.get('/sync/runs', async (req, res) => {
    res.json(await useCases().getSyncStatus.listRuns({ limit: queryString(req.query.limit) }));
  });

  // Batch export --------------------------------------------------------------------
  router.post('/exports', limiters.exports, async (req, res) => {
    const result = await useCases().exportBatchLetters.execute({
      participantIds: req.body?.participantIds,
      format: req.body?.format,
      markAsPrinted: req.body?.markAsPrinted === true,
      includeAttachments: req.body?.includeAttachments !== false,
      originalFormat: req.body?.originalFormat !== false,
      afterDate: req.body?.afterDate ?? null,
      actor: actorOf(req),
    });
    res.status(201).json({
      filename: result.filename,
      format: result.format,
      mimeType: result.mimeType,
      participantIds: result.participantIds,
      participantCount: result.participantCount,
      letterCount: result.letterCount,
      uniqueLetterCount: result.uniqueLetterCount,
      markedAsPrinted: result.markedAsPrinted,
      downloadUrl: `/api/exports/${encodeURIComponent(result.filename)}`,
    });
  });

  router.get('/exports/:filename', limiters.exports, async (req, res) => {
    const storage = runtime.container.exportStorage;
    const filePath = storage.resolvePath(req.params.filename);
    try {
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error('not a file');
    } catch {
      throw new AppError('EXPORT_NOT_FOUND', 404);
    }
    res.download(filePath, basename(filePath), { dotfiles: 'deny' });
  });

  return router;
}
