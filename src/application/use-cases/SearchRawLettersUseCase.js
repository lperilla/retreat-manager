import { indexParticipantsById } from '../../domain/entities/Participant.js';
import { normalizeText, normalizeWithMap, sliceOriginal } from '../../domain/services/text.js';
import { presentLetter } from '../services/presenters.js';
import { integerInRange, requireString } from '../services/validation.js';

const SNIPPET_RADIUS = 90;
export const MAX_SEARCH_LIMIT = 50;

/**
 * @param {string} body
 * @param {string[]} tokens
 * @returns {string}
 */
function buildSnippet(body, tokens) {
  const { text, map } = normalizeWithMap(body, { keepNewlines: false });
  if (!text) return '';
  let at = -1;
  for (const token of tokens) {
    const index = text.indexOf(token);
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) at = 0;
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + SNIPPET_RADIUS);
  const fragment = sliceOriginal(body, map, start, end).replace(/\s+/g, ' ');
  return `${start > 0 ? '…' : ''}${fragment}${end < text.length ? '…' : ''}`;
}

/**
 * Accent/case-insensitive search over subject, sender and body of ALL active letters,
 * including unassigned ones . Every query word must match.
 */
export class SearchRawLettersUseCase {
  #letters;
  #participants;

  /**
   * @param {{
   *   letterStore: import('../ports/LetterStoreRepositoryPort.js').LetterStoreRepositoryPort,
   *   participantRepository: import('../ports/ParticipantRepositoryPort.js').ParticipantRepositoryPort,
   * }} deps
   */
  constructor({ letterStore, participantRepository }) {
    this.#letters = letterStore;
    this.#participants = participantRepository;
  }

  /**
   * @param {{ query: string, limit?: number }} input
   */
  async execute(input) {
    const query = requireString(input?.query, 'query', { min: 2, max: 200 });
    const limit = integerInRange(input.limit, 'limit', { min: 1, max: MAX_SEARCH_LIMIT, fallback: 20 });
    const tokens = [...new Set(normalizeText(query).split(' ').filter(Boolean))];
    const phrase = normalizeText(query);

    const [letters, participants] = await Promise.all([this.#letters.findAll(), this.#participants.findAll()]);
    const participantsById = indexParticipantsById(participants);

    const scored = [];
    for (const letter of letters) {
      const subject = normalizeText(letter.subject);
      const from = normalizeText(letter.from);
      const body = normalizeText(letter.cleanBody);
      const haystack = `${subject} ${from} ${body}`;
      if (!tokens.every((token) => haystack.includes(token))) continue;
      let score = 0;
      if (subject.includes(phrase)) score += 3;
      if (body.includes(phrase)) score += 2;
      for (const token of tokens) {
        if (subject.includes(token)) score += 1;
        if (from.includes(token)) score += 0.5;
      }
      scored.push({ letter, score });
    }
    scored.sort((a, b) => b.score - a.score || b.letter.receivedAt.getTime() - a.letter.receivedAt.getTime());

    return {
      query,
      total: scored.length,
      results: scored.slice(0, limit).map(({ letter, score }) => ({
        ...presentLetter(letter, { participantsById, includeBody: false }),
        score,
        snippet: buildSnippet(letter.cleanBody, tokens),
      })),
    };
  }
}
