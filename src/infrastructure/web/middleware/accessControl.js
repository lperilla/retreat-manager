import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { AppError } from '../../../domain/errors.js';

export const SESSION_COOKIE = 'retreat_session';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * Constant-time string comparison (both sides hashed to a fixed length first).
 * @param {string} provided
 * @param {string} expected
 * @returns {boolean}
 */
export function safeEqual(provided, expected) {
  const a = createHash('sha256').update(String(provided ?? ''), 'utf8').digest();
  const b = createHash('sha256').update(String(expected ?? ''), 'utf8').digest();
  return timingSafeEqual(a, b);
}

/**
 * @param {string | undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  /** @type {Record<string, string>} */
  const cookies = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(raw);
    } catch {
      cookies[name] = raw;
    }
  }
  return cookies;
}

/**
 * Optional access control. When ACCESS_TOKEN is not configured (loopback-only use) every
 * request is allowed. Otherwise a request is authenticated by:
 * - `Authorization: Bearer <ACCESS_TOKEN>` (API clients), or
 * - the HttpOnly session cookie set by POST /login (browser). The cookie stores an HMAC of
 *   the token, never the token itself.
 * @param {{ accessToken: string | null }} options
 */
export function createAccessControl({ accessToken }) {
  const enabled = Boolean(accessToken);
  const sessionValue = enabled
    ? createHmac('sha256', /** @type {string} */ (accessToken)).update('retreat-mail-mcp:session:v1').digest('hex')
    : '';

  /**
   * @param {import('express').Request} req
   * @returns {boolean}
   */
  function isAuthenticated(req) {
    if (!enabled) return true;
    const authorization = req.get('authorization') ?? '';
    if (/^bearer\s+/i.test(authorization)) {
      return safeEqual(authorization.replace(/^bearer\s+/i, '').trim(), /** @type {string} */ (accessToken));
    }
    const cookie = parseCookies(req.get('cookie'))[SESSION_COOKIE];
    return Boolean(cookie) && safeEqual(cookie, sessionValue);
  }

  /** @type {import('express').RequestHandler} */
  function requireApiAuth(req, _res, next) {
    if (isAuthenticated(req)) return next();
    return next(new AppError('UNAUTHORIZED', 401));
  }

  /** @type {import('express').RequestHandler} */
  function requirePageAuth(req, res, next) {
    if (isAuthenticated(req)) return next();
    return res.redirect(303, '/login');
  }

  /**
   * POST /login (form field "token").
   * @type {import('express').RequestHandler}
   */
  function handleLogin(req, res) {
    if (!enabled) return res.redirect(303, '/');
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    if (!safeEqual(token, /** @type {string} */ (accessToken))) {
      return res.redirect(303, '/login?error=1');
    }
    res.cookie(SESSION_COOKIE, sessionValue, {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure,
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS * 1000,
    });
    return res.redirect(303, '/');
  }

  /** @type {import('express').RequestHandler} */
  function handleLogout(req, res) {
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'strict', secure: req.secure, path: '/' });
    return res.redirect(303, enabled ? '/login' : '/');
  }

  return { enabled, isAuthenticated, requireApiAuth, requirePageAuth, handleLogin, handleLogout };
}
