import { describeError } from '../../../application/services/errorDescription.js';
import { AppError, ERROR_MESSAGES, isAppError } from '../../../domain/errors.js';

/**
 * Rejects mutating API requests that are not JSON (also a CSRF mitigation together with
 * the SameSite=Strict session cookie).
 * @returns {import('express').RequestHandler}
 */
export function requireJson() {
  return (req, _res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return next(new AppError('UNSUPPORTED_MEDIA_TYPE', 415));
    }
    return next();
  };
}

/**
 * @returns {import('express').RequestHandler}
 */
export function apiNotFound() {
  return (_req, _res, next) => next(new AppError('ROUTE_NOT_FOUND', 404));
}

/**
 * Maps every error to `{ code, message }` (Spanish message) with the right HTTP status.
 * Unknown errors are logged and answered with INTERNAL_ERROR (details never leak).
 * @param {{ logger: import('../../../application/ports/LoggerPort.js').LoggerPort }} options
 * @returns {import('express').ErrorRequestHandler}
 */
export function errorHandler({ logger }) {
  return (error, req, res, _next) => {
    /** @type {AppError} */
    let appError;
    const bodyParserType = /** @type {{ type?: string }} */ (error)?.type;
    if (isAppError(error)) {
      appError = error;
    } else if (bodyParserType === 'entity.parse.failed') {
      appError = new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'malformed JSON body' });
    } else if (bodyParserType === 'entity.too.large') {
      appError = new AppError('PAYLOAD_TOO_LARGE', 413);
    } else {
      logger.error({ err: describeError(error), method: req.method, path: req.path }, 'Unhandled request error');
      appError = new AppError('INTERNAL_ERROR', 500);
    }

    if (appError.httpStatus >= 500 && isAppError(error)) {
      logger.error({ code: appError.code, details: appError.details, path: req.path }, 'Request failed');
    }
    const retryAfter = /** @type {{ retryAfterSeconds?: number } | null} */ (appError.details)?.retryAfterSeconds;
    if (retryAfter) res.setHeader('Retry-After', String(retryAfter));
    if (res.headersSent) return;

    const body = { code: appError.code, message: appError.message || ERROR_MESSAGES.INTERNAL_ERROR };
    if (retryAfter) Object.assign(body, { retryAfterSeconds: retryAfter });
    res.status(appError.httpStatus || 500).json(body);
  };
}

/**
 * Minimal access log (method, path, status, duration). Never logs query strings or bodies.
 * @param {{ logger: import('../../../application/ports/LoggerPort.js').LoggerPort }} options
 * @returns {import('express').RequestHandler}
 */
export function requestLogger({ logger }) {
  return (req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      const fields = { method: req.method, path: req.path, status: res.statusCode, durationMs: Math.round(durationMs) };
      if (res.statusCode >= 500) logger.error(fields, 'HTTP request');
      else if (req.path.startsWith('/api/')) logger.debug(fields, 'HTTP request');
    });
    next();
  };
}
