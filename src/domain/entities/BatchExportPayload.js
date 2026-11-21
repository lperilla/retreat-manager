import { AppError } from '../errors.js';

/**
 * @typedef {Object} BatchExportSection
 * @property {{ id: string, displayName: string }} participant
 * @property {import('./Letter.js').Letter[]}       letters      Chronological, active only.
 * @property {number}                               letterCount
 */

/**
 * Renderer-agnostic content of a batch export (HTML / TXT / JSON adapters consume it).
 * @typedef {Object} BatchExportPayload
 * @property {Date}                 generatedAt
 * @property {string}               timeZone
 * @property {number}               participantCount
 * @property {number}               letterCount        Sum over sections (a multi-recipient letter counts once per section).
 * @property {number}               uniqueLetterCount  Distinct messageIds across sections.
 * @property {BatchExportSection[]} sections           One per participant (page break between sections).
 */

/**
 * @param {{ generatedAt: Date, timeZone: string, sections: BatchExportSection[] }} props
 * @returns {Readonly<BatchExportPayload>}
 */
export function createBatchExportPayload(props) {
  const { generatedAt, timeZone, sections } = props ?? {};
  if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'generatedAt must be a valid Date' });
  }
  if (!Array.isArray(sections)) {
    throw new AppError('VALIDATION_ERROR', 400, undefined, { reason: 'sections must be an array' });
  }

  const frozenSections = sections.map((section) =>
    Object.freeze({
      participant: Object.freeze({ id: section.participant.id, displayName: section.participant.displayName }),
      letters: Object.freeze([...section.letters]),
      letterCount: section.letters.length,
    }),
  );
  const unique = new Set();
  for (const section of frozenSections) for (const letter of section.letters) unique.add(letter.messageId);

  return Object.freeze({
    generatedAt: new Date(generatedAt.getTime()),
    timeZone: String(timeZone),
    participantCount: frozenSections.length,
    letterCount: frozenSections.reduce((sum, section) => sum + section.letterCount, 0),
    uniqueLetterCount: unique.size,
    sections: Object.freeze(frozenSections),
  });
}
