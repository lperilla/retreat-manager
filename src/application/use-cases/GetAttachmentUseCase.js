import { AppError } from '../../domain/errors.js';
import { integerInRange, oneOf, requireString } from '../services/validation.js';

export const ATTACHMENT_VARIANTS = Object.freeze(['original', 'display', 'thumbnail']);

/**
 * Serves attachment contents on demand (download from the mail source, cached on disk by
 * the processor). Attachments are addressed by letter and position, never by raw ids.
 */
export class GetAttachmentUseCase {
  #letters;
  #processor;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   attachmentProcessor: import('../ports/AttachmentProcessorPort.js').AttachmentProcessorPort | null,
   * }} deps
   */
  constructor({ letterStore, attachmentProcessor }) {
    this.#letters = letterStore;
    this.#processor = attachmentProcessor;
  }

  get available() {
    return this.#processor !== null;
  }

  /**
   * @param {{ messageId: unknown, index: unknown }} input
   */
  async #locate(input) {
    if (!this.#processor) throw new AppError('ATTACHMENTS_UNAVAILABLE', 503);
    const messageId = requireString(input?.messageId, 'messageId', { max: 200 });
    const index = integerInRange(input?.index, 'index', { min: 0, max: 500, fallback: -1 });
    const letter = await this.#letters.findById(messageId);
    const attachment = letter && !letter.deletedAt ? letter.attachments[index] : undefined;
    if (!letter || letter.deletedAt) throw new AppError('LETTER_NOT_FOUND', 404, undefined, { messageId });
    if (!attachment) throw new AppError('ATTACHMENT_NOT_FOUND', 404, undefined, { messageId, index });
    return { processor: this.#processor, messageId, attachment };
  }

  /**
   * @param {{ messageId: string, index: number | string, variant?: string }} input
   */
  async getContent(input) {
    const variant = oneOf(input?.variant, 'variant', ATTACHMENT_VARIANTS, 'original');
    const { processor, messageId, attachment } = await this.#locate(input);
    const content = await processor.getContent({ messageId, attachment, variant: /** @type {any} */ (variant) });
    return { ...content, kind: processor.classify(attachment), variant };
  }

  /**
   * DOCX attachments: extracted plain text, shown as part of the letter.
   * @param {{ messageId: string, index: number | string }} input
   */
  async extractText(input) {
    const { processor, messageId, attachment } = await this.#locate(input);
    return { filename: attachment.filename, text: await processor.extractText({ messageId, attachment }) };
  }
}
