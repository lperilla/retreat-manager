/**
 * Attachment classification from METADATA only (filename + MIME type). Pure function:
 * the adapter that downloads files additionally verifies the real content (magic bytes).
 *
 * Allowlist: JPEG, PNG, WEBP, GIF, HEIC/HEIF images, PDF and DOCX.
 * SVG, executables, scripts and HTML are BLOCKED (never processed nor downloaded).
 * Anything else is UNSUPPORTED ("Adjunto no imprimible", download only).
 */

/** @enum {string} */
export const AttachmentKind = Object.freeze({
  IMAGE: 'image',
  PDF: 'pdf',
  DOCX: 'docx',
  UNSUPPORTED: 'unsupported',
  BLOCKED: 'blocked',
});

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const IMAGE_MIMES = new Map([
  ['image/jpeg', ['.jpg', '.jpeg', '.jfif']],
  ['image/jpg', ['.jpg', '.jpeg']],
  ['image/pjpeg', ['.jpg', '.jpeg']],
  ['image/png', ['.png']],
  ['image/webp', ['.webp']],
  ['image/gif', ['.gif']],
  ['image/heic', ['.heic']],
  ['image/heif', ['.heif', '.heic']],
]);
const IMAGE_EXTENSIONS = new Set([...IMAGE_MIMES.values()].flat());
const GENERIC_MIMES = new Set(['application/octet-stream', 'binary/octet-stream', 'application/x-download', '']);

const BLOCKED_EXTENSIONS = new Set([
  '.svg', '.svgz', '.exe', '.msi', '.msp', '.bat', '.cmd', '.com', '.scr', '.pif', '.cpl', '.dll', '.sys',
  '.js', '.mjs', '.cjs', '.jse', '.vbs', '.vbe', '.wsf', '.wsh', '.ps1', '.psm1', '.hta', '.jar', '.sh',
  '.bash', '.app', '.apk', '.dmg', '.iso', '.img', '.lnk', '.reg', '.html', '.htm', '.xhtml', '.mht',
  '.docm', '.xlsm', '.pptm', '.dotm',
]);
const BLOCKED_MIME_PATTERNS = [
  /^image\/svg/,
  /^text\/html/,
  /^application\/xhtml/,
  /javascript/,
  /ecmascript/,
  /^application\/x-(msdownload|msdos-program|dosexec|executable|elf|mach-binary|sh|csh|bat|msi)/,
  /^application\/vnd\.microsoft\.portable-executable/,
  /^application\/java-archive/,
  /^application\/vnd\.ms-.*macroenabled/i,
  /^application\/hta/,
];

/**
 * @param {string} filename
 * @returns {string}  Lower-case extension including the dot ('' when none).
 */
export function fileExtension(filename) {
  const match = /(\.[^./\\]+)$/.exec(String(filename ?? '').trim().toLowerCase());
  return match ? match[1] : '';
}

/**
 * @param {{ filename?: string, mimeType?: string }} attachment
 * @returns {string} One of AttachmentKind.
 */
export function classifyAttachment(attachment) {
  const mime = String(attachment?.mimeType ?? '').trim().toLowerCase().split(';')[0];
  const extension = fileExtension(attachment?.filename ?? '');

  if (BLOCKED_EXTENSIONS.has(extension) || BLOCKED_MIME_PATTERNS.some((pattern) => pattern.test(mime))) {
    return AttachmentKind.BLOCKED;
  }
  const generic = GENERIC_MIMES.has(mime);
  if (IMAGE_MIMES.has(mime) || (generic && IMAGE_EXTENSIONS.has(extension))) return AttachmentKind.IMAGE;
  if (mime === 'application/pdf' || (generic && extension === '.pdf')) return AttachmentKind.PDF;
  if (mime === DOCX_MIME || ((generic || mime === 'application/zip') && extension === '.docx')) return AttachmentKind.DOCX;
  return AttachmentKind.UNSUPPORTED;
}

/**
 * Inline images referenced from the body (`cid:`), e.g. "[cid:image001.png@01DB...]".
 * @param {{ contentId?: string | null, filename?: string, mimeType?: string }} attachment
 * @returns {boolean}
 */
export function isInlineImage(attachment) {
  return Boolean(attachment?.contentId) && classifyAttachment(attachment) === AttachmentKind.IMAGE;
}

/** Matches "[cid:…]" markers left in plain-text bodies by mail clients. */
export const CID_MARKER = /\[cid:([^\]\s]+)\]/gi;
