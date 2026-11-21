import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import express from 'express';

import { AppError } from '../../../domain/errors.js';

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
 *   limiters: { sync: import('express').RequestHandler, exports: import('express').RequestHandler },
 * }} options
 * @returns {import('express').Router}
 */
export function createApiRouter({ runtime, limiters }) {
  const router = express.Router();
  const useCases = () => runtime.container.useCases;

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
    res.json(await useCases().updatePrintStatus.execute({ participantIds: req.body?.participantIds, status: req.body?.status }));
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
      }),
    );
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
      }),
    );
  });

  router.post('/review/:messageId/unassign', async (req, res) => {
    res.json(await useCases().reviewAssignment.leaveUnassigned({ messageId: req.params.messageId }));
  });

  router.post('/review/:messageId/reset', async (req, res) => {
    res.json(await useCases().reviewAssignment.resetToAutomatic({ messageId: req.params.messageId }));
  });

  router.post('/assignments/recompute', async (_req, res) => {
    res.json(await useCases().recomputeAssignments.execute());
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
      afterDate: req.body?.afterDate ?? null,
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
