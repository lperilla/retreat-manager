import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describeError } from '../../application/services/errorDescription.js';
import { AttachmentKind, DOCX_MIME, classifyAttachment } from '../../domain/services/attachments.js';
import { AppError } from '../../domain/errors.js';
import { IMAGE_CONTENT_TYPES, detectFileType } from './fileSignature.js';

const DISPLAY_MAX_PX = 1600;
const THUMBNAIL_MAX_PX = 320;
const MAX_INPUT_PIXELS = 100_000_000;

/**
 * AttachmentProcessorPort adapter.
 *
 * - Downloads on demand through the AttachmentSourcePort and caches files on disk under
 *   CACHE_DIR/attachments/ (cache keys are hashes: no user input reaches the file system).
 *   Letters themselves are never cached on disk.
 * - Refuses blocked types (SVG, executables…) and files larger than MAX_ATTACHMENT_MB.
 * - Verifies the real content (magic bytes) before processing; unverified files are only
 *   served as `application/octet-stream` downloads.
 * - Images: EXIF orientation fixed, HEIC→JPEG (when the installed libvips can decode it),
 *   metadata (GPS…) stripped, display and thumbnail JPEG variants.
 * - DOCX: plain text extracted with mammoth (rendered as text, never as HTML).
 * @implements {import('../../application/ports/AttachmentProcessorPort.js').AttachmentProcessorPort}
 */
export class AttachmentProcessor {
  #source;
  #cacheRoot;
  #maxBytes;
  #logger;
  /** @type {Map<string, Promise<Buffer>>} */
  #inflight = new Map();

  /**
   * @param {{
   *   source: import('../../application/ports/AttachmentSourcePort.js').AttachmentSourcePort,
   *   cacheDir: string,
   *   maxBytes: number,
   *   logger: import('../../application/ports/LoggerPort.js').LoggerPort,
   * }} options
   */
  constructor({ source, cacheDir, maxBytes, logger }) {
    this.#source = source;
    this.#cacheRoot = resolve(cacheDir, 'attachments');
    this.#maxBytes = maxBytes;
    this.#logger = logger.child({ component: 'attachments' });
  }

  /** @param {import('../../domain/entities/Letter.js').AttachmentMeta} attachment */
  classify(attachment) {
    return classifyAttachment(attachment);
  }

  /**
   * @param {string} messageId
   * @param {import('../../domain/entities/Letter.js').AttachmentMeta} attachment
   * @returns {string}
   */
  #cacheDirFor(messageId, attachment) {
    const key = createHash('sha256')
      .update(`${messageId}\u0000${attachment.attachmentId ?? ''}\u0000${attachment.contentId ?? ''}\u0000${attachment.filename}\u0000${attachment.size}`)
      .digest('hex');
    return join(this.#cacheRoot, key.slice(0, 2), key);
  }

  /**
   * @param {string} file
   * @returns {Promise<Buffer | null>}
   */
  async #readCache(file) {
    try {
      return await readFile(file);
    } catch {
      return null;
    }
  }

  /**
   * @param {string} file
   * @param {Uint8Array | string} data
   */
  async #writeCache(file, data) {
    const directory = resolve(file, '..');
    await mkdir(directory, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temp, data);
    try {
      await rename(temp, file);
    } catch (error) {
      await rm(temp, { force: true });
      this.#logger.warn({ err: describeError(error) }, 'Attachment cache write failed');
    }
  }

  /**
   * Runs `task` once per key even under concurrent requests.
   * @param {string} key
   * @param {() => Promise<Buffer>} task
   */
  #once(key, task) {
    const existing = this.#inflight.get(key);
    if (existing) return existing;
    const promise = task().finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, promise);
    return promise;
  }

  /**
   * @param {import('../../domain/entities/Letter.js').AttachmentMeta} attachment
   */
  #assertAllowed(attachment) {
    if (classifyAttachment(attachment) === AttachmentKind.BLOCKED) {
      throw new AppError('ATTACHMENT_BLOCKED', 415, undefined, { mimeType: attachment.mimeType });
    }
    if (attachment.size > this.#maxBytes) {
      throw new AppError('ATTACHMENT_TOO_LARGE', 413, undefined, { size: attachment.size, maxBytes: this.#maxBytes });
    }
  }

  /**
   * Original bytes (cached).
   * @param {string} messageId
   * @param {import('../../domain/entities/Letter.js').AttachmentMeta} attachment
   * @returns {Promise<Buffer>}
   */
  async #original(messageId, attachment) {
    const file = join(this.#cacheDirFor(messageId, attachment), 'original.bin');
    return this.#once(file, async () => {
      const cached = await this.#readCache(file);
      if (cached) return cached;
      const bytes = Buffer.from(await this.#source.fetchAttachment({ messageId, attachment }));
      if (bytes.length > this.#maxBytes) {
        throw new AppError('ATTACHMENT_TOO_LARGE', 413, undefined, { size: bytes.length, maxBytes: this.#maxBytes });
      }
      await this.#writeCache(file, bytes);
      return bytes;
    });
  }

  /**
   * Whether the bytes match the declared kind.
   * @param {string} kind
   * @param {Buffer} bytes
   */
  #verified(kind, bytes) {
    const detected = detectFileType(bytes);
    if (kind === AttachmentKind.IMAGE) return detected !== null && detected in IMAGE_CONTENT_TYPES;
    if (kind === AttachmentKind.PDF) return detected === 'pdf';
    if (kind === AttachmentKind.DOCX) return detected === 'zip';
    return false;
  }

  /**
   * @param {{ messageId: string, attachment: import('../../domain/entities/Letter.js').AttachmentMeta, variant: 'original' | 'display' | 'thumbnail' }} request
   * @returns {Promise<import('../../application/ports/AttachmentProcessorPort.js').AttachmentContent>}
   */
  async getContent({ messageId, attachment, variant }) {
    this.#assertAllowed(attachment);
    const kind = classifyAttachment(attachment);
    const original = await this.#original(messageId, attachment);
    const verified = this.#verified(kind, original);

    if (variant === 'original') {
      let mimeType = 'application/octet-stream';
      if (verified && kind === AttachmentKind.IMAGE) mimeType = IMAGE_CONTENT_TYPES[/** @type {keyof typeof IMAGE_CONTENT_TYPES} */ (detectFileType(original))];
      if (verified && kind === AttachmentKind.PDF) mimeType = 'application/pdf';
      if (verified && kind === AttachmentKind.DOCX) mimeType = DOCX_MIME;
      return { data: original, mimeType, filename: attachment.filename, verified };
    }

    if (kind !== AttachmentKind.IMAGE || !verified) {
      throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, undefined, { reason: 'not a verified image', kind });
    }
    const maxPx = variant === 'thumbnail' ? THUMBNAIL_MAX_PX : DISPLAY_MAX_PX;
    const file = join(this.#cacheDirFor(messageId, attachment), `${variant}.jpg`);
    const data = await this.#once(file, async () => {
      const cached = await this.#readCache(file);
      if (cached) return cached;
      let output;
      try {
        // sharp (native) is loaded on first use, not at startup.
        const { default: sharp } = await import('sharp');
        output = await sharp(original, { limitInputPixels: MAX_INPUT_PIXELS, animated: false })
          .rotate()
          .resize({ width: maxPx, height: maxPx, fit: 'inside', withoutEnlargement: true })
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: variant === 'thumbnail' ? 78 : 85, mozjpeg: true })
          .toBuffer();
      } catch (error) {
        this.#logger.warn({ err: describeError(error), mimeType: attachment.mimeType }, 'Image could not be converted');
        throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, undefined, { reason: describeError(error) });
      }
      await this.#writeCache(file, output);
      return output;
    });
    return { data, mimeType: 'image/jpeg', filename: attachment.filename.replace(/\.[^.]+$/, '') + '.jpg', verified: true };
  }

  /**
   * @param {{ messageId: string, attachment: import('../../domain/entities/Letter.js').AttachmentMeta }} request
   * @returns {Promise<string>}
   */
  async extractText({ messageId, attachment }) {
    this.#assertAllowed(attachment);
    if (classifyAttachment(attachment) !== AttachmentKind.DOCX) {
      throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, undefined, { reason: 'not a DOCX document' });
    }
    const file = join(this.#cacheDirFor(messageId, attachment), 'text.txt');
    const cached = await this.#readCache(file);
    if (cached) return cached.toString('utf8');
    const original = await this.#original(messageId, attachment);
    if (!this.#verified(AttachmentKind.DOCX, original)) {
      throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, undefined, { reason: 'content is not a DOCX archive' });
    }
    let text;
    try {
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer: original });
      text = normalizeExtractedText(result.value);
    } catch (error) {
      throw new AppError('ATTACHMENT_NOT_PROCESSABLE', 422, undefined, { reason: describeError(error) });
    }
    await this.#writeCache(file, text);
    return text;
  }
}

/**
 * Removes control characters and collapses blank lines (paragraphs are kept).
 * @param {string} text
 * @returns {string}
 */
export function normalizeExtractedText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
