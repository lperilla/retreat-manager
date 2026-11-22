/**
 * Strict security headers for every response. No inline scripts or styles are allowed;
 * images only from the app itself (plus data:/blob: for Bootstrap icons and previews).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Print view: same policy plus inline style ATTRIBUTES (never <style> blocks or scripts), so
 * letters keep the sender's formatting. Those attributes only come from the letter HTML
 * sanitizer, whose allowlist accepts colours, fonts, sizes and alignment, never url().
 */
export const PRINT_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY.replace(
  "style-src 'self'",
  "style-src 'self'; style-src-attr 'unsafe-inline'",
);

/**
 * @returns {import('express').RequestHandler}
 */
export function securityHeaders() {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.path.startsWith('/api/') || req.path === '/print') {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  };
}
