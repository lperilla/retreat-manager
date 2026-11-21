import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CursorExpiredError } from '../../src/application/ports/MailSourcePort.js';
import { GmailMailSource } from '../../src/infrastructure/gmail/GmailMailSource.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { b64url, fakeGmail, gmailMessage, httpError } from '../helpers/gmailFakes.js';

const fastRetry = { sleep: async () => {}, random: () => 0 };

/**
 * @param {any} gmail
 * @param {Record<string, unknown>} [options]
 */
const source = (gmail, options = {}) => new GmailMailSource({ gmail, logger: new NullLogger(), retry: fastRetry, ...options });

describe('GmailMailSource attachments', () => {
  const withAttachment = (/** @type {any} */ body) =>
    gmailMessage('msg', {
      text: 'Hola',
      attachments: [
        { mimeType: 'application/pdf', filename: 'carta.pdf', body },
        { mimeType: 'image/png', filename: '', headers: [{ name: 'Content-ID', value: '<firma@x>' }], body: { data: b64url('PNGDATA') } },
      ],
    });

  it('downloads with the stored attachment id', async () => {
    const gmail = fakeGmail({ attachments: { 'att-1': b64url('%PDF-1.4 hola') } });
    const bytes = await source(gmail).fetchAttachment({
      messageId: 'msg',
      attachment: { filename: 'carta.pdf', mimeType: 'application/pdf', size: 13, contentId: null, attachmentId: 'att-1' },
    });
    assert.equal(Buffer.from(bytes).toString('latin1'), '%PDF-1.4 hola');
    assert.deepEqual(gmail.calls.map(([name]) => name), ['attachments.get']);
  });

  it('re-reads the message when the stored id is no longer valid, and supports inline part data', async () => {
    const gmail = fakeGmail({
      messages: { msg: withAttachment({ attachmentId: 'fresh-id', size: 13 }) },
      attachments: { 'fresh-id': b64url('%PDF-1.4 nuevo') },
    });
    const pdf = await source(gmail).fetchAttachment({
      messageId: 'msg',
      attachment: { filename: 'carta.pdf', mimeType: 'application/pdf', size: 13, contentId: null, attachmentId: 'stale-id' },
    });
    assert.equal(Buffer.from(pdf).toString('latin1'), '%PDF-1.4 nuevo');
    assert.deepEqual(gmail.calls.map(([name]) => name), ['attachments.get', 'messages.get', 'attachments.get']);

    const inline = await source(gmail).fetchAttachment({
      messageId: 'msg',
      attachment: { filename: 'imagen-firma@x', mimeType: 'image/png', size: 7, contentId: 'firma@x', attachmentId: null },
    });
    assert.equal(Buffer.from(inline).toString('latin1'), 'PNGDATA');
  });

  it('reports ATTACHMENT_NOT_FOUND when the part cannot be located', async () => {
    const gmail = fakeGmail({ messages: { msg: gmailMessage('msg', { text: 'Sin adjuntos' }) } });
    await assert.rejects(
      source(gmail).fetchAttachment({
        messageId: 'msg',
        attachment: { filename: 'otro.pdf', mimeType: 'application/pdf', size: 1, contentId: null, attachmentId: null },
      }),
      { code: 'ATTACHMENT_NOT_FOUND' },
    );
  });
});

describe('GmailMailSource full sync', () => {
  it('captures the historyId BEFORE listing, paginates and returns a complete listing', async () => {
    const gmail = fakeGmail({
      historyId: '12345',
      listPages: { 'label:retiro': [{ ids: ['a', 'b'], next: 'page-1' }, { ids: ['c', 'draft', 'spam', 'sent'] }] },
      messages: {
        a: gmailMessage('a', { subject: 'Carta para Juan', text: 'Querido Juan:\nÁnimo 😊', internalDate: '1795251600000' }),
        b: gmailMessage('b', { text: 'Hola' }),
        c: gmailMessage('c', { labels: ['INBOX', 'SENT'], text: 'Respuesta propia en la bandeja' }),
        draft: gmailMessage('draft', { labels: ['DRAFT'], text: 'Borrador' }),
        spam: gmailMessage('spam', { labels: ['SPAM'], text: 'Spam' }),
        sent: gmailMessage('sent', { labels: ['SENT'], text: 'Enviado por el equipo' }),
      },
    });
    const changes = await source(gmail, { query: 'label:retiro' }).fetchChanges(null);

    assert.equal(gmail.calls[0][0], 'getProfile');
    assert.equal(gmail.calls[1][0], 'messages.list');
    assert.equal(gmail.calls[1][1].q, 'label:retiro');
    assert.equal(gmail.calls.filter(([name]) => name === 'messages.list').length, 2);

    assert.equal(changes.isFullListing, true);
    assert.equal(changes.nextCursor, '12345');
    assert.deepEqual(changes.deletedMessageIds, []);
    assert.deepEqual(changes.letters.map((l) => l.messageId), ['a', 'b', 'c']);

    const [a] = changes.letters;
    assert.equal(a.subject, 'Carta para Juan');
    assert.equal(a.body, 'Querido Juan:\nÁnimo 😊');
    assert.equal(a.from, 'Familia <familia@example.com>');
    assert.equal(a.threadId, 't-a');
    assert.equal(a.receivedAt.toISOString(), new Date(1795251600000).toISOString());
    assert.equal(a.headers.subject, 'Carta para Juan');
  });
});

describe('GmailMailSource incremental sync', () => {
  it('reads every history page, returns new and deleted messages and the latest historyId', async () => {
    const gmail = fakeGmail({
      historyPages: [
        {
          history: [
            { messagesAdded: [{ message: { id: 'n1' } }, { message: { id: 'n2' } }] },
            { messagesDeleted: [{ message: { id: 'old-1' } }] },
          ],
          historyId: '1001',
          next: 'page-1',
        },
        {
          history: [{ messagesAdded: [{ message: { id: 'n3' } }] }, { messagesDeleted: [{ message: { id: 'n2' } }] }],
          historyId: '1002',
        },
      ],
      messages: {
        n1: gmailMessage('n1', { text: 'Querida Ana:\nÁnimo.' }),
        n2: gmailMessage('n2', { text: 'Se borró' }),
        n3: gmailMessage('n3', { labels: ['DRAFT'], text: 'Borrador' }),
      },
    });
    const changes = await source(gmail).fetchChanges('1000');

    const historyCalls = gmail.calls.filter(([name]) => name === 'history.list');
    assert.equal(historyCalls.length, 2);
    assert.equal(historyCalls[0][1].startHistoryId, '1000');
    assert.deepEqual(historyCalls[0][1].historyTypes, ['messageAdded', 'messageDeleted']);
    assert.equal(historyCalls[1][1].pageToken, 'page-1');

    assert.equal(changes.isFullListing, false);
    assert.equal(changes.nextCursor, '1002');
    assert.deepEqual(changes.letters.map((l) => l.messageId), ['n1']);
    assert.deepEqual(changes.deletedMessageIds.sort(), ['n2', 'old-1']);
    assert.equal(gmail.calls.some(([name, params]) => name === 'messages.get' && params.id === 'n2'), false);
  });

  it('keeps the cursor when nothing changed', async () => {
    const gmail = fakeGmail({ historyPages: [{ historyId: '1000' }] });
    const changes = await source(gmail).fetchChanges('1000');
    assert.deepEqual(changes, { letters: [], deletedMessageIds: [], nextCursor: '1000', isFullListing: false });
  });

  it('treats a message deleted before it could be downloaded (404) as deleted', async () => {
    const gmail = fakeGmail({ historyPages: [{ history: [{ messagesAdded: [{ message: { id: 'gone' } }] }], historyId: '5' }] });
    const changes = await source(gmail).fetchChanges('4');
    assert.deepEqual(changes.letters, []);
    assert.deepEqual(changes.deletedMessageIds, ['gone']);
  });

  it('throws CursorExpiredError when the history id is no longer valid (HTTP 404)', async () => {
    const gmail = fakeGmail({ historyErrors: [httpError(404)] });
    await assert.rejects(source(gmail).fetchChanges('1'), CursorExpiredError);
  });

  it('post-filters new messages with GMAIL_QUERY (history reports every mailbox change)', async () => {
    const gmail = fakeGmail({
      historyPages: [{ history: [{ messagesAdded: [{ message: { id: 'letter' } }, { message: { id: 'newsletter' } }] }], historyId: '7' }],
      messages: {
        letter: gmailMessage('letter', { text: 'Querido Juan:', internalDate: '1795251600000' }),
        newsletter: gmailMessage('newsletter', { text: 'Ofertas', internalDate: '1795255200000' }),
      },
      listPages: { '(to:cartas@example.com)': [{ ids: ['letter'] }] },
    });
    const changes = await source(gmail, { query: 'to:cartas@example.com' }).fetchChanges('6');
    const listCall = gmail.calls.find(([name]) => name === 'messages.list');
    assert.match(listCall?.[1].q, /^\(to:cartas@example\.com\) after:\d+$/);
    assert.deepEqual(changes.letters.map((l) => l.messageId), ['letter']);
  });

  it('uses the label filter and label history when GMAIL_LABEL_ID is set', async () => {
    const gmail = fakeGmail({
      historyPages: [
        {
          history: [
            { messagesAdded: [{ message: { id: 'in-label' } }, { message: { id: 'no-label' } }] },
            { labelsAdded: [{ message: { id: 'labelled-later' }, labelIds: ['Label_7'] }] },
            { labelsRemoved: [{ message: { id: 'unlabelled' }, labelIds: ['Label_7'] }] },
          ],
          historyId: '20',
        },
      ],
      messages: {
        'in-label': gmailMessage('in-label', { labels: ['INBOX', 'Label_7'], text: 'Carta' }),
        'no-label': gmailMessage('no-label', { labels: ['INBOX'], text: 'Otra cosa' }),
        'labelled-later': gmailMessage('labelled-later', { labels: ['Label_7'], text: 'Carta archivada' }),
      },
    });
    const changes = await source(gmail, { labelId: 'Label_7', query: 'ignored when a label is set' }).fetchChanges('19');
    const historyCall = gmail.calls.find(([name]) => name === 'history.list');
    assert.equal(historyCall?.[1].labelId, 'Label_7');
    assert.deepEqual(historyCall?.[1].historyTypes, ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved']);
    assert.deepEqual(changes.letters.map((l) => l.messageId).sort(), ['in-label', 'labelled-later']);
    assert.deepEqual(changes.deletedMessageIds, ['unlabelled']);
    assert.equal(gmail.calls.some(([name]) => name === 'messages.list'), false);
  });

  it('retries 429/5xx with backoff and caps download concurrency', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const gmail = fakeGmail({
      historyErrors: [httpError(503), httpError(429, { 'retry-after': '0' })],
      historyPages: [{ history: [{ messagesAdded: ids.map((id) => ({ message: { id } })) }], historyId: '50' }],
      messages: Object.fromEntries(ids.map((id) => [id, gmailMessage(id, { text: 'Hola' })])),
      getDelayMs: 5,
    });
    const changes = await source(gmail, { concurrency: 3 }).fetchChanges('49');
    assert.equal(changes.letters.length, 12);
    assert.equal(gmail.calls.filter(([name]) => name === 'history.list').length, 3);
    assert.ok(gmail.stats.maxActive <= 3, `max concurrency was ${gmail.stats.maxActive}`);
    assert.ok(gmail.stats.maxActive >= 2);
  });

  it('does not retry client errors other than 404/429', async () => {
    const gmail = fakeGmail({ historyErrors: [httpError(400)] });
    await assert.rejects(source(gmail).fetchChanges('1'), /HTTP 400/);
    assert.equal(gmail.calls.filter(([name]) => name === 'history.list').length, 1);
  });
});
