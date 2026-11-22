import express from 'express';

import { catalogsView } from '../../domain/catalogs.js';

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function queryString(value) {
  if (Array.isArray(value)) return queryString(value[0]);
  return typeof value === 'string' ? value : undefined;
}

/**
 * JSON API of the participants module (mounted under /api, behind the same access control,
 * JSON guard and error handler as the rest of the dashboard API).
 *
 *   GET    /retreat                     active retreat + deletion schedule
 *   PUT    /retreat                     { name, startDate, endDate }
 *   POST   /retreat/close               { confirmName }  close now and delete its data
 *   GET    /catalogs                    allergens, intolerances, diets, accessibility needs
 *   GET    /participants?q=&filter=     list
 *   POST   /participants                full registration, or { quick: true, ... } from the letters screen
 *   GET    /participants/:id            detail
 *   PUT    /participants/:id            edit
 *   POST   /participants/:id/withdraw   dar de baja
 *   POST   /participants/:id/reactivate
 *   PUT    /participants/:id/attendance  { confirmed: true | false }
 *   DELETE /participants/:id            only without assigned letters
 * @param {{ runtime: import('../../../../infrastructure/web/WebRuntime.js').WebRuntime }} options
 * @returns {import('express').Router}
 */
export function createParticipantsRouter({ runtime }) {
  const router = express.Router();
  const participants = () => runtime.container.useCases.participants;
  const retreat = () => runtime.container.useCases.retreat;

  router.get('/retreat', async (_req, res) => {
    res.json(await retreat().get());
  });
  router.put('/retreat', async (req, res) => {
    res.json(await retreat().update(req.body ?? {}));
  });
  router.post('/retreat/close', async (req, res) => {
    res.json(await retreat().close({ confirmName: req.body?.confirmName }));
  });

  router.get('/catalogs', (_req, res) => {
    res.json(catalogsView());
  });

  router.get('/participants', async (req, res) => {
    res.json(await participants().list({ q: queryString(req.query.q) ?? '', filter: queryString(req.query.filter) ?? 'all' }));
  });
  router.post('/participants', async (req, res) => {
    const body = req.body ?? {};
    res.status(201).json(await participants().create(body, { quick: body.quick === true }));
  });
  router.get('/participants/:id', async (req, res) => {
    res.json(await participants().get({ id: req.params.id }));
  });
  router.put('/participants/:id', async (req, res) => {
    res.json(await participants().update(req.params.id, req.body ?? {}));
  });
  router.post('/participants/:id/withdraw', async (req, res) => {
    res.json(await participants().withdraw(req.params.id));
  });
  router.put('/participants/:id/attendance', async (req, res) => {
    res.json(await participants().setAttendance(req.params.id, { confirmed: req.body?.confirmed }));
  });
  router.post('/participants/:id/reactivate', async (req, res) => {
    res.json(await participants().reactivate(req.params.id));
  });
  router.delete('/participants/:id', async (req, res) => {
    res.json(await participants().delete(req.params.id));
  });

  return router;
}
