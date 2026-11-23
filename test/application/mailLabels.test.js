import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError } from '../../src/domain/errors.js';
import { GmailLabelService } from '../../src/infrastructure/gmail/GmailLabelService.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { FakeClock, ScriptedMailSource, buildTestContainer, makeMessage } from '../helpers/applicationFakes.js';
import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { httpError } from '../helpers/gmailFakes.js';

const MESSAGES = [
  makeMessage({ messageId: 'u1', subject: 'Carta para Juan', receivedAt: new Date('2026-11-18T09:00:00Z') }),
  makeMessage({
    messageId: 'u2',
    subject: 'Con adjunto',
    body: 'Querido Juan:\nTe mandamos una foto.',
    from: 'Abuela <abuela@example.com>',
    receivedAt: new Date('2026-11-19T10:00:00Z'),
    attachments: [{ filename: 'foto.jpg', mimeType: 'image/jpeg', size: 1000, attachmentId: 'a1' }],
  }),
  makeMessage({ messageId: 'u3', subject: 'Carta para Juan y Lucía', receivedAt: new Date('2026-11-20T12:00:00Z') }),
  makeMessage({ messageId: 'u4', subject: 'Ánimo', body: 'Querida María:\nMucha fuerza desde Córdoba.', receivedAt: new Date('2026-11-21T08:00:00Z') }),
];

/** In-memory Gmail: labels per message, counting creations and modify calls. */
class FakeLabelPort {
  constructor() {
    /** @type {Map<string, Set<string>>} */
    this.messages = new Map();
    /** @type {Set<string>} */
    this.created = new Set();
    this.calls = 0;
    /** @type {Error | null} */
    this.failWith = null;
    /** @type {Set<string>} */
    this.missing = new Set();
  }

  labelsOf(messageId) {
    return [...(this.messages.get(messageId) ?? [])].sort();
  }

  async applyChanges(changes) {
    this.calls += 1;
    if (this.failWith) throw this.failWith;
    for (const change of changes) for (const name of change.add) this.created.add(name);
    return changes.map((change) => {
      if (this.missing.has(change.messageId)) return { messageId: change.messageId, ok: false, error: 'El mensaje ya no existe en Gmail' };
      const set = this.messages.get(change.messageId) ?? new Set();
      change.add.forEach((name) => set.add(name));
      change.remove.forEach((name) => set.delete(name));
      this.messages.set(change.messageId, set);
      return { messageId: change.messageId, ok: true };
    });
  }
}

async function labelledContainer() {
  const labelPort = new FakeLabelPort();
  const mailSource = new ScriptedMailSource(() => ({ letters: MESSAGES, deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true }));
  const built = await buildTestContainer({
    mailSource,
    env: { GMAIL_LABELS_ENABLED: 'true', GMAIL_LABEL_PREFIX: 'Retiro' },
    overrides: { labelPort },
  });
  return { ...built, labelPort };
}

describe('Gmail labels: sync, manual assignment and printed label', () => {
  it('labels assigned letters after a sync and leaves the ones to review alone', async () => {
    const { container, labelPort } = await labelledContainer();
    await container.useCases.syncMailbox.execute();

    assert.deepEqual(labelPort.labelsOf('u1'), ['Retiro/Juan Pérez']);
    assert.deepEqual(labelPort.labelsOf('u2'), ['Retiro/Juan Pérez']); // letter with attachment
    assert.deepEqual(labelPort.labelsOf('u3'), ['Retiro/Juan Pérez', 'Retiro/Lucía Fernández']);
    assert.deepEqual(labelPort.labelsOf('u4'), []); // ambiguous: waits for a person

    const state = await container.repositories.labelStateRepository.findByMessageIds(['u1']);
    assert.equal(state[0].error, null);
    assert.equal(state[0].updatedBy, 'sync');
    assert.ok(state[0].syncedAt);
  });

  it('is idempotent: a second sync and a second label pass call Gmail zero times', async () => {
    const { container, labelPort, clock } = await labelledContainer();
    await container.useCases.syncMailbox.execute();
    const calls = labelPort.calls;
    clock.advance(600);
    await container.useCases.syncMailbox.execute({ mode: 'full' });
    const summary = await container.useCases.syncMailLabels.execute({ actor: 'Ana' });
    assert.equal(labelPort.calls, calls);
    assert.equal(summary.applied, 0);
    assert.equal(summary.unchanged, 4);
    // "force" reapplies (safe: Gmail ignores labels a message already has).
    const forced = await container.useCases.syncMailLabels.execute({ force: true });
    assert.equal(forced.applied, 3);
  });

  it('reset deletes the labels Gmail has under the prefix (even unknown ones) and applies them again', async () => {
    const { container, labelPort } = await labelledContainer();
    await container.useCases.syncMailbox.execute();
    // A stale label from a previous install, unknown to the local state, plus a label of the user's own.
    labelPort.gmailLabels = ['Retiro/Antigua', 'Trabajo'];
    labelPort.listLabelNames = async () => labelPort.gmailLabels;
    labelPort.deleteLabels = async (names) => {
      labelPort.deletedNames = names;
      for (const set of labelPort.messages.values()) names.forEach((n) => set.delete(n));
      return names;
    };
    labelPort.messages.get('u1').add('Retiro/Antigua');

    const summary = await container.useCases.syncMailLabels.reset({ actor: 'Ana' });

    assert.ok(labelPort.deletedNames.includes('Retiro/Antigua'));
    assert.ok(labelPort.deletedNames.includes('Retiro/Juan Pérez'));
    assert.equal(labelPort.deletedNames.includes('Trabajo'), false);
    assert.equal(summary.applied, 3);
    assert.deepEqual(labelPort.labelsOf('u1'), ['Retiro/Juan Pérez']);
    assert.deepEqual(labelPort.labelsOf('u3'), ['Retiro/Juan Pérez', 'Retiro/Lucía Fernández']);
  });

  it('applies the participant label on manual correction and moves it on reassignment, tracing the user', async () => {
    const { container, labelPort } = await labelledContainer();
    await container.useCases.syncMailbox.execute();

    await container.useCases.reviewAssignment.assign({ messageId: 'u4', participantIds: ['maria-lopez'], actor: 'Carmen' });
    assert.deepEqual(labelPort.labelsOf('u4'), ['Retiro/María López']);

    await container.useCases.reviewAssignment.assign({ messageId: 'u4', participantIds: ['maria-garcia'], actor: 'Luis' });
    assert.deepEqual(labelPort.labelsOf('u4'), ['Retiro/María García']); // old one removed, no stacking

    const audit = await container.repositories.auditLogRepository.find({ messageId: 'u4' });
    const actions = audit.map((e) => `${e.actor}:${e.action}`);
    assert.ok(actions.includes('Carmen:assignment.set'));
    assert.ok(actions.includes('Luis:assignment.set'));
    assert.ok(actions.includes('Luis:labels.applied'));
    const state = (await container.repositories.labelStateRepository.findByMessageIds(['u4']))[0];
    assert.equal(state.updatedBy, 'Luis');
  });

  it('adds and removes the printed label per letter, and per participant for a shared letter', async () => {
    const { container, labelPort } = await labelledContainer();
    await container.useCases.syncMailbox.execute();
    const { updatePrintStatus } = container.useCases;

    await updatePrintStatus.setLetterPrinted({ messageId: 'u1', printed: true, actor: 'Ana' });
    assert.deepEqual(labelPort.labelsOf('u1'), ['Impreso', 'Retiro/Juan Pérez']);
    assert.deepEqual(labelPort.labelsOf('u2'), ['Retiro/Juan Pérez']); // other letters untouched

    // u3 belongs to Juan and Lucía: printed label only when printed for both.
    await updatePrintStatus.execute({ participantIds: ['juan-perez'], status: 'printed', messageIds: ['u3'], actor: 'Ana' });
    assert.equal(labelPort.labelsOf('u3').includes('Impreso'), false);
    await updatePrintStatus.execute({ participantIds: ['lucia-fernandez'], status: 'printed', messageIds: ['u3'], actor: 'Ana' });
    assert.equal(labelPort.labelsOf('u3').includes('Impreso'), true);

    await updatePrintStatus.setLetterPrinted({ messageId: 'u1', printed: false, actor: 'Luis' });
    assert.deepEqual(labelPort.labelsOf('u1'), ['Retiro/Juan Pérez']);

    const printAudit = (await container.repositories.auditLogRepository.find({ messageId: 'u1' })).filter((e) => e.action.startsWith('print.'));
    assert.deepEqual(printAudit.map((e) => `${e.actor}:${e.action}`).sort(), ['Ana:print.marked', 'Luis:print.unmarked']);
  });

  it('replaces old labels when the prefix or printed label is renamed, and deletes them from Gmail', async () => {
    const labelPort = new FakeLabelPort();
    const deleted = [];
    labelPort.deleteLabels = async (names) => {
      deleted.push(...names);
      return names;
    };
    const persistence = createJsonPersistence({ directory: null, clock: new FakeClock() });
    const make = (env) =>
      buildTestContainer({
        mailSource: new ScriptedMailSource(() => ({ letters: MESSAGES, deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true })),
        persistence,
        env: { GMAIL_LABELS_ENABLED: 'true', ...env },
        overrides: { labelPort },
      });

    const first = await make({ GMAIL_LABEL_PREFIX: 'Retiro', GMAIL_PRINTED_LABEL: 'Impreso' });
    await first.container.useCases.syncMailbox.execute();
    await first.container.useCases.updatePrintStatus.setLetterPrinted({ messageId: 'u1', printed: true, actor: 'Ana' });
    assert.deepEqual(labelPort.labelsOf('u1'), ['Impreso', 'Retiro/Juan Pérez']);

    // Same database, new names (what saving the settings does after reloading the container).
    const second = await make({ GMAIL_LABEL_PREFIX: '', GMAIL_PRINTED_LABEL: 'Hecho' });
    const summary = await second.container.useCases.syncMailLabels.execute({ actor: 'Luis' });

    assert.deepEqual(labelPort.labelsOf('u1'), ['Hecho', 'Juan Pérez']); // old ones gone from the message
    assert.deepEqual(labelPort.labelsOf('u3'), ['Juan Pérez', 'Lucía Fernández']);
    assert.deepEqual(deleted.sort(), ['Impreso', 'Retiro/Juan Pérez', 'Retiro/Lucía Fernández']);
    assert.deepEqual(summary.deletedLabels.sort(), deleted.sort());

    // Nothing left to do afterwards.
    const calls = labelPort.calls;
    await second.container.useCases.syncMailLabels.execute({ actor: 'Luis' });
    assert.equal(labelPort.calls, calls);
  });

  it('rejects printing a letter that has no participant', async () => {
    const { container } = await labelledContainer();
    await container.useCases.syncMailbox.execute();
    await assert.rejects(container.useCases.updatePrintStatus.setLetterPrinted({ messageId: 'u4', printed: true }), { code: 'VALIDATION_ERROR' });
    await assert.rejects(container.useCases.updatePrintStatus.setLetterPrinted({ messageId: 'nope', printed: true }), { code: 'LETTER_NOT_FOUND' });
  });

  it('keeps the error of a message that fails and retries it on the next pass', async () => {
    const { container, labelPort } = await labelledContainer();
    labelPort.missing.add('u1');
    await container.useCases.syncMailbox.execute();
    let [state] = await container.repositories.labelStateRepository.findByMessageIds(['u1']);
    assert.match(state.error ?? '', /ya no existe/);
    assert.equal((await container.useCases.syncMailLabels.status()).withErrors, 1);

    labelPort.missing.clear();
    const summary = await container.useCases.syncMailLabels.execute({ actor: 'Ana' });
    assert.equal(summary.applied, 1);
    [state] = await container.repositories.labelStateRepository.findByMessageIds(['u1']);
    assert.equal(state.error, null);
    assert.deepEqual(labelPort.labelsOf('u1'), ['Retiro/Juan Pérez']);
  });

  it('surfaces permission errors on a manual label pass, but never breaks the saved change', async () => {
    const { container, labelPort } = await labelledContainer();
    await container.useCases.syncMailbox.execute();
    labelPort.failWith = new AppError('GMAIL_INSUFFICIENT_PERMISSIONS', 403);

    // The manual correction succeeds in the database even though Gmail refuses.
    const view = await container.useCases.reviewAssignment.assign({ messageId: 'u4', participantIds: ['maria-lopez'], actor: 'Ana' });
    assert.equal(view.assignment.participants[0].id, 'maria-lopez');

    await assert.rejects(container.useCases.syncMailLabels.execute({ actor: 'Ana' }), (error) => {
      assert.equal(error.code, 'GMAIL_INSUFFICIENT_PERMISSIONS');
      assert.match(error.message, /npm run auth/);
      return true;
    });

    // Once permissions are fixed, the pending difference is applied.
    labelPort.failWith = null;
    await container.useCases.syncMailLabels.execute({ actor: 'Ana' });
    assert.deepEqual(labelPort.labelsOf('u4'), ['Retiro/María López']);
  });

  it('is disabled by default: audit still works, label sync answers LABELS_DISABLED', async () => {
    const mailSource = new ScriptedMailSource(() => ({ letters: MESSAGES, deletedMessageIds: [], nextCursor: 'h-1', isFullListing: true }));
    const { container } = await buildTestContainer({ mailSource });
    await container.useCases.syncMailbox.execute();
    assert.equal((await container.useCases.syncMailLabels.status()).enabled, false);
    await assert.rejects(container.useCases.syncMailLabels.execute(), { code: 'LABELS_DISABLED' });
    await container.useCases.reviewAssignment.assign({ messageId: 'u4', participantIds: ['maria-lopez'], actor: 'Ana' });
    assert.equal((await container.repositories.auditLogRepository.find({ messageId: 'u4' })).length, 1);
  });
});

describe('ListMailUseCase', () => {
  it('filters by participant, label, sender, date and print state', async () => {
    const { container } = await labelledContainer();
    await container.useCases.syncMailbox.execute();
    await container.useCases.updatePrintStatus.setLetterPrinted({ messageId: 'u1', printed: true, actor: 'Ana' });
    const list = (filter) => container.useCases.listMail.execute(filter).then((r) => r.messages.map((m) => m.messageId));

    assert.deepEqual(await list({}), ['u4', 'u3', 'u2', 'u1']); // newest first
    assert.deepEqual((await list({ participantId: 'lucia-fernandez' })), ['u3']);
    assert.deepEqual(await list({ label: 'retiro/juan pérez' }), ['u3', 'u2', 'u1']);
    assert.deepEqual(await list({ label: 'Impreso' }), ['u1']);
    assert.deepEqual(await list({ printed: 'true' }), ['u1']);
    assert.deepEqual(await list({ printed: 'false', participantId: 'juan-perez' }), ['u3', 'u2']);
    assert.deepEqual(await list({ sender: 'abuela' }), ['u2']);
    assert.deepEqual(await list({ hasAttachments: 'true' }), ['u2']);
    assert.deepEqual(await list({ from: '2026-11-19', to: '2026-11-20' }), ['u3', 'u2']);

    const [first] = (await container.useCases.listMail.execute({ participantId: 'juan-perez', printed: 'true' })).messages;
    assert.equal(first.gmail.inSync, true);
    assert.equal(first.gmail.updatedBy, 'Ana');
    await assert.rejects(container.useCases.listMail.execute({ from: 'ayer' }), { code: 'INVALID_DATE' });
  });
});

/** Minimal fake of the googleapis Gmail surface used by GmailLabelService. */
function fakeGmailLabels({ labels = [], modifyErrors = {}, createError = null } = {}) {
  const state = { labels: [...labels], creates: 0, lists: 0, modifies: [] };
  return {
    state,
    users: {
      labels: {
        async list() {
          state.lists += 1;
          return { data: { labels: state.labels } };
        },
        async patch({ id, requestBody }) {
          state.patches = [...(state.patches ?? []), { id, ...requestBody }];
          return { data: {} };
        },
        async get({ id }) {
          return { data: { id, messagesTotal: state.totals?.[id] ?? 0 } };
        },
        async delete({ id }) {
          state.deletes = [...(state.deletes ?? []), id];
          state.labels = state.labels.filter((label) => label.id !== id);
        },
        async create({ requestBody }) {
          state.creates += 1;
          state.created = [...(state.created ?? []), requestBody];
          if (createError) {
            // Another process created it first.
            state.labels.push({ id: `L${state.labels.length + 1}`, name: requestBody.name });
            throw createError;
          }
          const label = { id: `L${state.labels.length + 1}`, name: requestBody.name };
          state.labels.push(label);
          return { data: label };
        },
      },
      messages: {
        async modify({ id, requestBody }) {
          if (modifyErrors[id]) throw modifyErrors[id];
          state.modifies.push({ id, ...requestBody });
          return { data: {} };
        },
      },
    },
  };
}

const service = (gmail) => new GmailLabelService({ gmail, logger: new NullLogger(), retry: { retries: 0 } });

describe('GmailLabelService', () => {
  it('reuses existing labels (case-insensitive) and creates each missing label once', async () => {
    const gmail = fakeGmailLabels({ labels: [{ id: 'L1', name: 'IMPRESO' }] });
    const labels = service(gmail);
    const results = await labels.applyChanges([
      { messageId: 'a', add: ['Impreso', 'Retiro/Ana'], remove: [] },
      { messageId: 'b', add: ['Retiro/Ana'], remove: ['Retiro/Antiguo'] },
    ]);
    assert.deepEqual(results.map((r) => r.ok), [true, true]);
    assert.equal(gmail.state.creates, 2); // parent "Retiro" and "Retiro/Ana"; Impreso was reused
    assert.deepEqual(gmail.state.modifies.find((m) => m.id === 'a').addLabelIds.sort(), ['L1', 'L3']);
    // A removed label that does not exist in Gmail is simply skipped.
    assert.deepEqual(gmail.state.modifies.find((m) => m.id === 'b').removeLabelIds, []);

    await labels.applyChanges([{ messageId: 'c', add: ['Retiro/Ana'], remove: [] }]);
    assert.equal(gmail.state.creates, 2);
    assert.equal(gmail.state.lists, 1); // cached
  });

  it('creates the printed label in green and turns an existing one green once', async () => {
    const fresh = fakeGmailLabels();
    await new GmailLabelService({ gmail: fresh, logger: new NullLogger(), printedLabel: 'Impreso', retry: { retries: 0 } }).applyChanges([
      { messageId: 'a', add: ['Impreso', 'Ana'], remove: [] },
    ]);
    const printed = fresh.state.created.find((l) => l.name === 'Impreso');
    assert.deepEqual(printed.color, { backgroundColor: '#16a766', textColor: '#ffffff' });
    assert.equal(fresh.state.created.find((l) => l.name === 'Ana').color, undefined);
    assert.equal(fresh.state.patches, undefined);

    const existing = fakeGmailLabels({ labels: [{ id: 'L9', name: 'impreso' }] });
    const labels = new GmailLabelService({ gmail: existing, logger: new NullLogger(), printedLabel: 'Impreso', retry: { retries: 0 } });
    await labels.applyChanges([{ messageId: 'a', add: ['Impreso'], remove: [] }]);
    await labels.applyChanges([{ messageId: 'b', add: ['Impreso'], remove: [] }]);
    assert.equal(existing.state.patches.length, 1);
    assert.equal(existing.state.patches[0].color.backgroundColor, '#16a766');
  });

  it('recovers when another process creates the label first (409)', async () => {
    const gmail = fakeGmailLabels({ createError: httpError(409) });
    const results = await service(gmail).applyChanges([{ messageId: 'a', add: ['Ana'], remove: [] }]);
    assert.equal(results[0].ok, true);
    assert.equal(gmail.state.labels.length, 1); // no duplicate
  });

  it('reports a message deleted from Gmail without failing the others', async () => {
    const gmail = fakeGmailLabels({ modifyErrors: { gone: httpError(404) } });
    const results = await service(gmail).applyChanges([
      { messageId: 'gone', add: ['Retiro/Ana'], remove: [] },
      { messageId: 'ok', add: ['Retiro/Ana'], remove: [] },
    ]);
    assert.equal(results[0].ok, false);
    assert.match(results[0].error, /ya no existe/);
    assert.equal(results[1].ok, true);
  });

  it('creates the parent label so participant labels nest under it', async () => {
    const gmail = fakeGmailLabels();
    const labels = new GmailLabelService({ gmail: gmail, logger: new NullLogger(), parentLabel: 'Retiro', retry: { retries: 0 } });
    await labels.applyChanges([{ messageId: 'a', add: ['Retiro/Ana', 'Retiro/Luis'], remove: [] }]);
    assert.deepEqual(gmail.state.labels.map((l) => l.name), ['Retiro', 'Retiro/Ana', 'Retiro/Luis']); // parent once, first
    // Even with no new children, a missing parent is created on first use.
    const orphan = fakeGmailLabels({ labels: [{ id: 'L1', name: 'Retiro/Ana' }] });
    await new GmailLabelService({ gmail: orphan, logger: new NullLogger(), parentLabel: 'Retiro', retry: { retries: 0 } }).applyChanges([
      { messageId: 'a', add: ['Retiro/Ana'], remove: [] },
    ]);
    assert.ok(orphan.state.labels.some((l) => l.name === 'Retiro'));
  });

  it('deletes the old parent label when it ends up empty, but keeps one that has messages', async () => {
    const labels = [{ id: 'P', name: 'Retiro' }, { id: 'C', name: 'Retiro/Ana' }];
    const empty = fakeGmailLabels({ labels: [...labels] });
    assert.deepEqual(await new GmailLabelService({ gmail: empty, logger: new NullLogger() }).deleteLabels(['Retiro/Ana']), ['Retiro/Ana', 'Retiro']);
    const used = fakeGmailLabels({ labels: [...labels] });
    used.state.totals = { P: 7 };
    assert.deepEqual(await new GmailLabelService({ gmail: used, logger: new NullLogger() }).deleteLabels(['Retiro/Ana']), ['Retiro/Ana']);
  });

  it('deletes retired labels by name and ignores the ones that do not exist', async () => {
    const gmail = fakeGmailLabels({ labels: [{ id: 'L1', name: 'Retiro/Ana' }] });
    gmail.users.labels.delete = async ({ id }) => {
      gmail.state.labels = gmail.state.labels.filter((label) => label.id !== id);
    };
    const labels = service(gmail);
    assert.deepEqual(await labels.deleteLabels(['retiro/ana', 'Nunca existió']), ['retiro/ana']);
    assert.equal(gmail.state.labels.length, 0);
  });

  it('maps authentication, permission and connection failures to clear errors', async () => {
    const insufficient = Object.assign(httpError(403), { response: { status: 403, data: { error: { errors: [{ reason: 'insufficientPermissions' }] } } } });
    await assert.rejects(
      service(fakeGmailLabels({ modifyErrors: { a: insufficient } })).applyChanges([{ messageId: 'a', add: ['X'], remove: [] }]),
      { code: 'GMAIL_INSUFFICIENT_PERMISSIONS' },
    );
    await assert.rejects(
      service(fakeGmailLabels({ modifyErrors: { a: httpError(401) } })).applyChanges([{ messageId: 'a', add: ['X'], remove: [] }]),
      { code: 'GMAIL_AUTH_ERROR' },
    );
    const offline = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
    await assert.rejects(
      service(fakeGmailLabels({ modifyErrors: { a: offline } })).applyChanges([{ messageId: 'a', add: ['X'], remove: [] }]),
      { code: 'GMAIL_UNAVAILABLE' },
    );
  });
});
