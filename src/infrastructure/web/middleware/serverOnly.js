import { AppError } from '../../../domain/errors.js';

/**
 * Whether a request comes from the server computer itself (the desktop app, or a browser on that
 * computer opened at localhost / 127.0.0.1). Requests through the network address — even from
 * the same computer — count as other devices. The app never runs behind a proxy (`trust proxy`
 * is off), so the socket address is the real client.
 * @param {Pick<import('express').Request, 'socket'>} req
 * @returns {boolean}
 */
export function isServerComputer(req) {
  const address = String(req.socket?.remoteAddress ?? '');
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Only the server computer may use the "Configuración" screen (settings, restart, Gmail
 * permission, label reset). Other devices get SETTINGS_SERVER_ONLY (403).
 * @returns {import('express').RequestHandler}
 */
export function requireServerComputer() {
  return (req, _res, next) => (isServerComputer(req) ? next() : next(new AppError('SETTINGS_SERVER_ONLY', 403)));
}
