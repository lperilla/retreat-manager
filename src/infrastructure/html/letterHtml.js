/**
 * Keeps the look of an HTML e-mail (colours, fonts, sizes, bold/italic, alignment, lists,
 * inline images) while removing everything that could run code, load remote content or
 * break the printed page.
 *
 * Strict allowlist (sanitize-html):
 * - text and layout tags only; links keep their text but lose the address;
 * - `style` attributes are filtered property by property and value by value: no `url()`,
 *   no `expression()`, no positioning, no sizes for boxes;
 * - legacy `<font color face size>` and `align` attributes become equivalent inline styles;
 * - images are kept only as `cid:` references to the message's own attachments (no remote
 *   images: they would track the reader and fail offline).
 */
import sanitizeHtml from 'sanitize-html';

/** Formatted bodies larger than this fall back to plain text. */
export const MAX_FORMATTED_BODY_CHARS = 300_000;

const COLOR = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i,
  /^hsla?\(\s*\d{1,3}(deg)?\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(,\s*(0|1|0?\.\d+))?\s*\)$/i,
  /^[a-z]{3,20}$/i,
];
const LENGTH = /^(0|\d{1,4}(\.\d{1,3})?(px|pt|em|rem|%|ex|ch))$/i;
const FONT_SIZE_KEYWORD = /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i;
const FONT_FAMILY = /^[\p{L}\p{N} ,'"_-]{1,200}$/u;

const ALLOWED_STYLES = Object.freeze({
  '*': {
    color: COLOR,
    'background-color': COLOR,
    'font-family': [FONT_FAMILY],
    'font-size': [LENGTH, FONT_SIZE_KEYWORD],
    'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/i],
    'font-style': [/^(normal|italic|oblique)$/i],
    'font-variant': [/^(normal|small-caps)$/i],
    'text-decoration': [/^(none|underline|overline|line-through)( (underline|overline|line-through))*$/i],
    'text-decoration-line': [/^(none|underline|overline|line-through)( (underline|overline|line-through))*$/i],
    'text-align': [/^(left|right|center|justify|start|end)$/i],
    'text-transform': [/^(none|uppercase|lowercase|capitalize)$/i],
    'line-height': [/^\d{1,2}(\.\d{1,3})?$/, LENGTH],
    'letter-spacing': [LENGTH, /^normal$/i],
    'text-indent': [LENGTH],
    'margin-left': [LENGTH],
    'padding-left': [LENGTH],
    'vertical-align': [/^(baseline|top|middle|bottom|sub|super)$/i],
  },
});

const ALLOWED_TAGS = Object.freeze([
  'p', 'div', 'span', 'br', 'hr', 'center',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'big', 'sub', 'sup', 'code', 'pre', 'tt',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption',
  'img',
]);

/** HTML `<font size="1..7">` → CSS sizes used by browsers. */
const FONT_TAG_SIZES = Object.freeze({ 1: '10px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' });

/**
 * @param {Record<string, string>} attribs
 * @param {string[]} declarations
 */
function withStyle(attribs, declarations) {
  const style = [attribs.style ?? '', ...declarations].map((part) => part.trim().replace(/;$/, '')).filter(Boolean).join('; ');
  const { align: _align, color: _color, face: _face, size: _size, ...rest } = attribs;
  return style ? { ...rest, style } : rest;
}

/**
 * `align="center"` → `text-align: center` (values are validated later by ALLOWED_STYLES).
 * @param {string} tagName
 * @param {Record<string, string>} attribs
 */
function alignToStyle(tagName, attribs) {
  return { tagName, attribs: withStyle(attribs, attribs.align ? [`text-align: ${attribs.align}`] : []) };
}

const SANITIZE_OPTIONS = Object.freeze({
  allowedTags: [...ALLOWED_TAGS],
  allowedAttributes: {
    '*': ['style'],
    img: ['src', 'alt'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    ol: ['start', 'type'],
  },
  allowedSchemes: [],
  allowedSchemesByTag: { img: ['cid'] },
  allowedSchemesAppliedToAttributes: ['src'],
  allowProtocolRelative: false,
  allowedStyles: ALLOWED_STYLES,
  parseStyleAttributes: true,
  disallowedTagsMode: /** @type {const} */ ('discard'),
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'head', 'title', 'template', 'svg', 'math', 'iframe', 'object'],
  transformTags: {
    font: (/** @type {string} */ _tag, /** @type {Record<string, string>} */ attribs) => {
      const declarations = [];
      if (attribs.color) declarations.push(`color: ${attribs.color}`);
      if (attribs.face) declarations.push(`font-family: ${attribs.face}`);
      const size = FONT_TAG_SIZES[/** @type {keyof typeof FONT_TAG_SIZES} */ (String(attribs.size ?? '').trim())];
      if (size) declarations.push(`font-size: ${size}`);
      return { tagName: 'span', attribs: withStyle(attribs, declarations) };
    },
    p: alignToStyle,
    div: alignToStyle,
    td: alignToStyle,
    th: alignToStyle,
    h1: alignToStyle,
    h2: alignToStyle,
    h3: alignToStyle,
    h4: alignToStyle,
    h5: alignToStyle,
    h6: alignToStyle,
  },
  // Images that lost their (non-cid) source are dropped entirely.
  exclusiveFilter: (/** @type {{ tag: string, attribs: Record<string, string> }} */ frame) => frame.tag === 'img' && !frame.attribs.src,
});

/**
 * Sanitizes the HTML of a letter (safe to render as HTML, with inline styles).
 * @param {string} html
 * @returns {string}
 */
export function sanitizeLetterHtml(html) {
  return sanitizeHtml(String(html ?? ''), /** @type {any} */ (SANITIZE_OPTIONS)).trim();
}

/** Markup that carries formatting the plain-text body would lose. */
const RICH_MARKUP = /\sstyle="|<(b|strong|i|em|u|s|strike|del|mark|big|small|sub|sup|h[1-6]|img|table|ul|ol|blockquote|center|pre)\b/i;

/**
 * Formatted body to store with a letter, or null when the HTML adds nothing to the plain
 * text (no styles or emphasis), is empty, or is too large.
 * @param {string | string[]} html  One or more `text/html` parts.
 * @returns {string | null}
 */
export function toFormattedBody(html) {
  const parts = (Array.isArray(html) ? html : [html]).map(sanitizeLetterHtml).filter(Boolean);
  if (parts.length === 0) return null;
  const joined = parts.join('\n');
  if (joined.length > MAX_FORMATTED_BODY_CHARS) return null;
  if (!RICH_MARKUP.test(joined)) return null;
  if (sanitizeHtml(joined, { allowedTags: [], allowedAttributes: {} }).trim() === '' && !/<img\b/i.test(joined)) return null;
  return joined;
}

/** `<img src="cid:…">` markers left by the sanitizer (attributes are already normalized). */
export const CID_IMAGE = /<img\b[^>]*?\bsrc="cid:([^"]+)"[^>]*>/gi;
