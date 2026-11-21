import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AssignmentStatus, FlagType } from '../../src/domain/constants.js';
import { createAssignment } from '../../src/domain/entities/Assignment.js';
import { summarizeRetreat } from '../../src/domain/services/counting.js';
import { groupParticipantLetters } from '../../src/domain/services/grouping.js';
import { computeFlags, normalizeHeaders, withMultiRecipientFlag } from '../../src/domain/services/heuristics.js';
import { PARTICIPANTS, assignedTo, makeLetter } from '../helpers/domainFixtures.js';

const types = (flags) => flags.map((f) => f.type);
const LETTER_BODY = 'Querido Juan:\nTe escribimos para decirte lo orgullosos que estamos de ti.\nUn abrazo,\nMamá';
const JPEG = { filename: 'carta.jpg', mimeType: 'image/jpeg', size: 120_000 };

describe('heuristic flags', () => {
  it('a normal letter has no flags', () => {
    assert.deepEqual(computeFlags({ subject: 'Carta para Juan', body: LETTER_BODY, participantIds: ['juan-perez'] }), []);
  });

  it('AUTO_REPLY from the Auto-Submitted header', () => {
    const flags = computeFlags({ subject: 'Hola', body: LETTER_BODY, headers: { 'Auto-Submitted': 'auto-replied' } });
    const flag = flags.find((f) => f.type === FlagType.AUTO_REPLY);
    assert.ok(flag);
    assert.equal(flag.confidence, 0.95);
    assert.match(flag.reason, /Auto-Submitted/);
  });

  it('AUTO_REPLY is not raised for "Auto-Submitted: no"', () => {
    const flags = computeFlags({ subject: 'Hola', body: LETTER_BODY, headers: { 'Auto-Submitted': 'no' } });
    assert.equal(types(flags).includes(FlagType.AUTO_REPLY), false);
  });

  it('AUTO_REPLY from the subject', () => {
    const flags = computeFlags({ subject: 'Respuesta automática: fuera de la oficina', body: LETTER_BODY });
    assert.ok(types(flags).includes(FlagType.AUTO_REPLY));
  });

  it('NEWSLETTER_OR_BULK from List-Unsubscribe or Precedence: bulk', () => {
    const viaUnsubscribe = computeFlags({ body: LETTER_BODY, headers: [{ name: 'List-Unsubscribe', value: '<mailto:x@y.z>' }] });
    assert.ok(types(viaUnsubscribe).includes(FlagType.NEWSLETTER_OR_BULK));
    const viaPrecedence = computeFlags({ body: LETTER_BODY, headers: new Map([['Precedence', 'bulk']]) });
    assert.ok(types(viaPrecedence).includes(FlagType.NEWSLETTER_OR_BULK));
  });

  it('MAILER_DAEMON from the sender or the subject', () => {
    const viaFrom = computeFlags({ from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>', body: LETTER_BODY });
    assert.ok(types(viaFrom).includes(FlagType.MAILER_DAEMON));
    const viaSubject = computeFlags({ subject: 'Delivery Status Notification (Failure)', body: LETTER_BODY });
    assert.ok(types(viaSubject).includes(FlagType.MAILER_DAEMON));
  });

  it('SIGNATURE_ONLY for a body that is only a mobile signature', () => {
    const flags = computeFlags({ body: '\n\nEnviado desde mi iPhone' });
    const flag = flags.find((f) => f.type === FlagType.SIGNATURE_ONLY);
    assert.ok(flag);
    assert.equal(flag.confidence, 0.9);
    assert.equal(types(flags).includes(FlagType.ATTACHMENT_ONLY), false);
  });

  it('SIGNATURE_ONLY with lower confidence for a very short text', () => {
    const flag = computeFlags({ body: '¡Ánimo!' }).find((f) => f.type === FlagType.SIGNATURE_ONLY);
    assert.ok(flag);
    assert.equal(flag.confidence, 0.6);
  });

  it('ATTACHMENT_ONLY (not SIGNATURE_ONLY) when the body is empty and there is an attachment', () => {
    const flags = computeFlags({ body: '', attachments: [JPEG] });
    assert.deepEqual(types(flags), [FlagType.ATTACHMENT_ONLY, FlagType.HAS_ATTACHMENTS]);
  });

  it('ATTACHMENT_ONLY when the only text is a signature and there is an attachment', () => {
    const flags = computeFlags({ body: 'Enviado desde mi iPhone', attachments: [JPEG] });
    assert.ok(types(flags).includes(FlagType.ATTACHMENT_ONLY));
    assert.equal(types(flags).includes(FlagType.SIGNATURE_ONLY), false);
  });

  it('a short text plus an attachment is a real letter (HAS_ATTACHMENTS only)', () => {
    const flags = computeFlags({ body: 'Te mando la carta escaneada, ¡ánimo!', attachments: [JPEG] });
    assert.deepEqual(types(flags), [FlagType.HAS_ATTACHMENTS]);
    assert.match(flags[0].reason, /1 adjunto/);
  });

  it('MULTI_RECIPIENT when assigned to two or more participants', () => {
    const flags = computeFlags({ body: LETTER_BODY, participantIds: ['juan-perez', 'ana-martin'] });
    assert.ok(types(flags).includes(FlagType.MULTI_RECIPIENT));
  });

  it('every flag has a type, a confidence in 0..1 and a Spanish reason', () => {
    const flags = computeFlags({
      subject: 'Respuesta automática',
      from: 'postmaster@example.com',
      body: '',
      headers: { 'List-Unsubscribe': '<x>', 'Auto-Submitted': 'auto-generated' },
      attachments: [JPEG, JPEG],
      participantIds: ['a', 'b'],
    });
    assert.ok(flags.length >= 5);
    for (const flag of flags) {
      assert.equal(typeof flag.type, 'string');
      assert.ok(flag.confidence >= 0 && flag.confidence <= 1);
      assert.ok(flag.reason.length > 0);
    }
  });

  it('withMultiRecipientFlag adds or removes only MULTI_RECIPIENT', () => {
    const base = computeFlags({ body: '', attachments: [JPEG] });
    const added = withMultiRecipientFlag(base, ['a', 'b']);
    assert.deepEqual(types(added), [FlagType.ATTACHMENT_ONLY, FlagType.MULTI_RECIPIENT, FlagType.HAS_ATTACHMENTS]);
    const removed = withMultiRecipientFlag(added, ['a']);
    assert.deepEqual(types(removed), [FlagType.ATTACHMENT_ONLY, FlagType.HAS_ATTACHMENTS]);
  });

  it('normalizeHeaders lowercases names', () => {
    const headers = normalizeHeaders({ 'List-Id': 'x', PRECEDENCE: 'bulk' });
    assert.equal(headers.get('list-id'), 'x');
    assert.equal(headers.get('precedence'), 'bulk');
  });
});

describe('flags never discard letters', () => {
  it('flagged letters are still counted and grouped', () => {
    const flags = computeFlags({ subject: 'Respuesta automática', body: '', headers: { 'Auto-Submitted': 'auto-replied' } });
    const flagged = makeLetter({ assignment: assignedTo(['juan-perez']), flags });
    const normal = makeLetter({ assignment: assignedTo(['juan-perez']) });
    const review = makeLetter({
      assignment: createAssignment({ status: AssignmentStatus.NEEDS_REVIEW }),
      flags: computeFlags({ body: '', attachments: [JPEG] }),
    });

    const summary = summarizeRetreat({ participants: PARTICIPANTS, letters: [flagged, normal, review] });
    assert.equal(summary.totalLetters, 3);
    assert.equal(summary.reviewQueueSize, 1);
    assert.equal(summary.flaggedLettersCount, 2);
    const juan = summary.perParticipant.find((s) => s.participantId === 'juan-perez');
    assert.equal(juan?.letterCount, 2);
    assert.equal(juan?.warningCount, 1);
    assert.equal(groupParticipantLetters([flagged, normal, review], 'juan-perez').length, 2);
  });
});
