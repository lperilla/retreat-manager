import express from 'express';

/**
 * JSON API of the accommodation module (mounted under /api like the rest of the dashboard API).
 *
 *   GET    /accommodation                    rooms, tables, occupants, warnings, each participant's room/table
 *   POST   /rooms            PUT /rooms/:id            DELETE /rooms/:id     (only when empty)
 *   POST   /tables           PUT /tables/:id           DELETE /tables/:id    (only when empty)
 *   PUT    /participants/:id/room            { roomId | null, bed? }
 *   PUT    /participants/:id/table           { tableId | null }
 * @param {{ runtime: import('../../../../infrastructure/web/WebRuntime.js').WebRuntime }} options
 * @returns {import('express').Router}
 */
export function createAccommodationRouter({ runtime }) {
  const router = express.Router();
  const accommodation = () => runtime.container.useCases.accommodation;

  router.get('/accommodation', async (_req, res) => {
    res.json(await accommodation().overview());
  });

  router.post('/rooms', async (req, res) => {
    res.status(201).json(await accommodation().createRoom(req.body ?? {}));
  });
  router.put('/rooms/:id', async (req, res) => {
    res.json(await accommodation().updateRoom(req.params.id, req.body ?? {}));
  });
  router.delete('/rooms/:id', async (req, res) => {
    res.json(await accommodation().deleteRoom(req.params.id));
  });

  router.post('/tables', async (req, res) => {
    res.status(201).json(await accommodation().createTable(req.body ?? {}));
  });
  router.put('/tables/:id', async (req, res) => {
    res.json(await accommodation().updateTable(req.params.id, req.body ?? {}));
  });
  router.delete('/tables/:id', async (req, res) => {
    res.json(await accommodation().deleteTable(req.params.id));
  });

  router.put('/participants/:id/room', async (req, res) => {
    res.json(await accommodation().assignRoom(req.params.id, { roomId: req.body?.roomId ?? null, bed: req.body?.bed ?? null }));
  });
  router.put('/participants/:id/table', async (req, res) => {
    res.json(await accommodation().assignTable(req.params.id, { tableId: req.body?.tableId ?? null }));
  });

  return router;
}
