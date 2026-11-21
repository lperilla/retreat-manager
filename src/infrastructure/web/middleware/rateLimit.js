import { AppError } from '../../../domain/errors.js';

/**
 * Small in-memory fixed-window rate limiter keyed by client IP (no external dependency).
 * @param {{ windowMs: number, max: number, name: string, now?: () => number }} options
 * @returns {import('express').RequestHandler & { reset: () => void }}
 */
export function rateLimit({ windowMs, max, name, now = Date.now }) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  /** @type {import('express').RequestHandler} */
  const middleware = (req, res, next) => {
    const current = now();
    if (hits.size > 10_000) {
      for (const [key, entry] of hits) if (entry.resetAt <= current) hits.delete(key);
    }
    const key = `${name}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= current) {
      entry = { count: 0, resetAt: current + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
      return next(new AppError('RATE_LIMITED', 429, undefined, { retryAfterSeconds, limiter: name }));
    }
    return next();
  };

  return Object.assign(middleware, { reset: () => hits.clear() });
}
