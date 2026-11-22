import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { PACKET_CSS } from '../rendering/packetStyles.js';
import { createAccessControl } from './middleware/accessControl.js';
import { apiNotFound, errorHandler, requestLogger, requireJson } from './middleware/errorHandler.js';
import { rateLimit } from './middleware/rateLimit.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { createApiRouter } from './routes/apiRoutes.js';
import { createParticipantsRouter } from '../../modules/participants/infrastructure/web/participantsRoutes.js';
import { createAccommodationRouter } from '../../modules/accommodation/infrastructure/web/accommodationRoutes.js';
import { createPrintHandler } from './routes/printRoute.js';

export const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'public');

/**
 * @typedef {Object} RateLimitSettings
 * @property {{ windowMs: number, max: number }} sync
 * @property {{ windowMs: number, max: number }} exports
 * @property {{ windowMs: number, max: number }} login
 * @property {{ windowMs: number, max: number }} [attachments]
 */

/** @type {RateLimitSettings} */
export const DEFAULT_RATE_LIMITS = Object.freeze({
  sync: { windowMs: 60_000, max: 6 },
  exports: { windowMs: 60_000, max: 30 },
  login: { windowMs: 15 * 60_000, max: 10 },
  attachments: { windowMs: 60_000, max: 600 },
});

/**
 * Builds the Express application (no listening here).
 * @param {{
 *   runtime: import('./WebRuntime.js').WebRuntime,
 *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
 *   accessToken: string | null,
 *   rateLimits?: RateLimitSettings,
 * }} options
 * @returns {import('express').Express}
 */
export function createWebApp({ runtime, logger, accessToken, rateLimits = DEFAULT_RATE_LIMITS }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('query parser', 'simple');

  const access = createAccessControl({ accessToken });
  const limiters = {
    sync: rateLimit({ ...rateLimits.sync, name: 'sync' }),
    exports: rateLimit({ ...rateLimits.exports, name: 'exports' }),
    login: rateLimit({ ...rateLimits.login, name: 'login' }),
    attachments: rateLimit({ ...(rateLimits.attachments ?? DEFAULT_RATE_LIMITS.attachments), name: 'attachments' }),
  };

  app.use(securityHeaders());
  app.use(requestLogger({ logger }));

  // Login (only meaningful when ACCESS_TOKEN is configured).
  app.get('/login', (req, res) => {
    if (!access.enabled || access.isAuthenticated(req)) return res.redirect(303, '/');
    return res.sendFile(join(PUBLIC_DIR, 'login.html'));
  });
  app.post('/login', limiters.login, express.urlencoded({ extended: false, limit: '2kb' }), access.handleLogin);
  app.post('/logout', access.handleLogout);

  // Static assets (no data inside; all data comes from the authenticated API).
  app.get('/css/packet.css', (_req, res) => {
    res.type('text/css').send(PACKET_CSS);
  });
  app.use(express.static(PUBLIC_DIR, { index: false, dotfiles: 'ignore', fallthrough: true }));

  // Pages.
  app.get('/', access.requirePageAuth, (_req, res) => {
    res.sendFile(join(PUBLIC_DIR, 'index.html'));
  });
  app.get('/print', access.requirePageAuth, createPrintHandler({ runtime, logger }));

  // API.
  app.use(
    '/api',
    access.requireApiAuth,
    express.json({ limit: '100kb' }),
    requireJson(),
    createApiRouter({ runtime, limiters }),
    createParticipantsRouter({ runtime }),
    createAccommodationRouter({ runtime }),
    apiNotFound(),
  );

  app.use(errorHandler({ logger }));
  return app;
}
