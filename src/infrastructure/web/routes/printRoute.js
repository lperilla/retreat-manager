import { isAppError } from '../../../domain/errors.js';
import { escapeHtml } from '../../rendering/format.js';
import { PRINT_CONTENT_SECURITY_POLICY } from '../middleware/securityHeaders.js';

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseIds(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((item) => typeof item === 'string')
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * @param {string} message
 * @returns {string}
 */
function errorPage(message) {
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>No se puede imprimir</title><link rel="stylesheet" href="/css/packet.css"></head>',
    `<body><main class="packet"><section class="participant"><h1>No se puede preparar la impresión</h1><p>${escapeHtml(message)}</p></section></main></body></html>`,
  ].join('');
}

/**
 * GET /print?participantIds=a,b[&afterDate=YYYY-MM-DD][&includeAttachments=0][&originalFormat=0][&autoprint=1]
 * Printable packet for the browser (one page per participant). Uses the same renderer as
 * the .html export, linking the stylesheet, the print script and the attachment images
 * (CSP forbids inline code; images are served by the authenticated attachment route).
 * This page alone allows inline style ATTRIBUTES, so each letter keeps the sender's colours,
 * fonts and sizes; they come from the sanitizer's allowlist (no url(), no scripts).
 * @param {{ runtime: import('../WebRuntime.js').WebRuntime, logger: import('../../../application/ports/LoggerPort.js').LoggerPort }} options
 * @returns {import('express').RequestHandler}
 */
export function createPrintHandler({ runtime, logger }) {
  return async (req, res) => {
    try {
      const container = runtime.container;
      const payload = await container.useCases.preparePrintView.execute({
        participantIds: parseIds(req.query.participantIds),
        afterDate: typeof req.query.afterDate === 'string' && req.query.afterDate ? req.query.afterDate : null,
      });
      const html = await container.htmlRenderer.render(payload, {
        stylesheetHref: '/css/packet.css',
        scriptHref: '/js/print-page.js',
        toolbar: true,
        includeAttachments: req.query.includeAttachments !== '0',
        originalFormat: req.query.originalFormat !== '0',
        attachmentUrl: (/** @type {string} */ messageId, /** @type {number} */ index, /** @type {string} */ variant) =>
          `/api/letters/${encodeURIComponent(messageId)}/attachments/${index}?variant=${variant}`,
      });
      res.setHeader('Content-Security-Policy', PRINT_CONTENT_SECURITY_POLICY);
      res.type('html').send(html);
    } catch (error) {
      if (!isAppError(error)) logger.error({ err: String(error) }, 'Print view failed');
      const status = isAppError(error) ? error.httpStatus : 500;
      const message = isAppError(error) ? error.message : 'Se ha producido un error interno.';
      res.status(status).type('html').send(errorPage(message));
    }
  };
}
