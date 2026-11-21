import { loadConfig } from '../../src/composition/config.js';
import { createContainer } from '../../src/composition/container.js';
import { createJsonPersistence } from '../../src/infrastructure/persistence/json/createJsonPersistence.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { PARTICIPANTS } from './domainFixtures.js';

/** Controllable clock. */
export class FakeClock {
  /** @param {string} [iso] */
  constructor(iso = '2026-11-21T10:00:00Z') {
    this.current = new Date(iso);
  }

  now() {
    return new Date(this.current.getTime());
  }

  /** @param {number} seconds */
  advance(seconds) {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/**
 * Mail source driven by a handler `(cursor, callIndex) => MailChanges | Promise<MailChanges>`.
 */
export class ScriptedMailSource {
  /** @param {(cursor: string | null, callIndex: number) => any} handler */
  constructor(handler) {
    this.handler = handler;
    /** @type {Array<string | null>} */
    this.calls = [];
  }

  /** @param {string | null} cursor */
  async fetchChanges(cursor) {
    this.calls.push(cursor);
    return this.handler(cursor, this.calls.length - 1);
  }
}

let counter = 0;

/**
 * Incoming mail-source message with defaults.
 * @param {Record<string, unknown>} [overrides]
 */
export function makeMessage(overrides = {}) {
  counter += 1;
  return {
    messageId: `m-${String(counter).padStart(4, '0')}`,
    threadId: `t-${counter}`,
    from: 'Familia Ejemplo <familia@example.com>',
    to: 'cartas@example.com',
    subject: 'Carta',
    receivedAt: new Date('2026-11-20T10:00:00Z'),
    body: 'Te pensamos mucho estos días, ánimo con todo.',
    attachments: [],
    headers: {},
    ...overrides,
  };
}

/** @template T */
export function deferred() {
  /** @type {(value: T) => void} */
  let resolve = () => {};
  /** @type {(error: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Builds a real container wired with in-memory adapters and test doubles.
 * @param {{
 *   mailSource?: any,
 *   participants?: any[],
 *   clock?: FakeClock,
 *   persistence?: any,
 *   minIntervalSeconds?: number,
 *   env?: Record<string, string>,
 *   overrides?: Record<string, unknown>,
 * }} [options]
 */
export async function buildTestContainer({
  mailSource = new ScriptedMailSource(() => ({ letters: [], deletedMessageIds: [], nextCursor: 'c0' })),
  participants = [...PARTICIPANTS],
  clock = new FakeClock(),
  persistence,
  minIntervalSeconds = 0,
  env = {},
  overrides = {},
} = {}) {
  const config = loadConfig({
    PERSISTENCE: 'json',
    TZ: 'Europe/Madrid',
    SYNC_MIN_INTERVAL_SECONDS: String(minIntervalSeconds),
    ...env,
  });
  let sequence = 0;
  const container = await createContainer({
    config,
    role: 'cli',
    overrides: {
      logger: new NullLogger(),
      clock,
      idGenerator: () => {
        sequence += 1;
        return `run-${sequence}`;
      },
      mailSource,
      persistence: persistence ?? createJsonPersistence({ directory: null, clock }),
      participants,
      ...overrides,
    },
  });
  return { container, clock, mailSource, config };
}
