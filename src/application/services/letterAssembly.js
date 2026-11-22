/**
 * Builds a domain Letter from an incoming mail-source message: assignment (manual
 * override wins) and heuristic flags (headers are only available here).
 */
import { createLetter } from '../../domain/entities/Letter.js';
import { AppError } from '../../domain/errors.js';
import { computeFlags } from '../../domain/services/heuristics.js';

/**
 * @param {import('../ports/MailSourcePort.js').IncomingMessage} message
 * @param {{
 *   participants: readonly import('../../domain/entities/Participant.js').Participant[],
 *   override?: import('../../domain/entities/AssignmentOverride.js').AssignmentOverride | null,
 *   strategy: import('../../domain/services/assignment.js').ContentAssignmentStrategy,
 *   signatureOnlyMaxChars?: number,
 * }} context
 * @returns {Readonly<import('../../domain/entities/Letter.js').Letter>}
 */
export function assembleLetter(message, { participants, override = null, strategy, signatureOnlyMaxChars }) {
  if (!message || typeof message.messageId !== 'string' || message.messageId.length === 0) {
    throw new AppError('INVALID_LETTER', 502, undefined, { reason: 'mail source returned a message without messageId' });
  }
  const subject = message.subject ?? '';
  const body = message.body ?? '';
  const from = message.from ?? '';
  const attachments = message.attachments ?? [];

  const assignment = strategy.assign({ subject, body, from }, participants, { override });
  const flags = computeFlags(
    { subject, body, from, headers: message.headers ?? {}, attachments, participantIds: assignment.participantIds },
    signatureOnlyMaxChars === undefined ? {} : { signatureOnlyMaxChars },
  );

  return createLetter({
    messageId: message.messageId,
    threadId: message.threadId ?? '',
    from,
    to: message.to ?? '',
    subject,
    receivedAt: message.receivedAt,
    cleanBody: body,
    formattedBody: message.formattedBody ?? null,
    attachments,
    assignment,
    flags,
  });
}
