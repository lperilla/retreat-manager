import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AppError } from '../../src/domain/errors.js';
import { NullLogger } from '../../src/infrastructure/logging/NullLogger.js';
import { parseCookies, safeEqual } from '../../src/infrastructure/web/middleware/accessControl.js';
import { rateLimit } from '../../src/infrastructure/web/middleware/rateLimit.js';
import { assertWebSecurity, isLoopbackHost, listAccessUrls } from '../../src/infrastructure/web/security/networkSecurity.js';
import { SyncScheduler } from '../../src/infrastructure/web/SyncScheduler.js';

describe('network security', () => {
  it('recognises loopback hosts', () => {
    for (const host of ['127.0.0.1', '127.0.1.1', 'localhost', '::1', '[::1]']) assert.equal(isLoopbackHost(host), true, host);
    for (const host of ['0.0.0.0', '192.168.1.20', '::', 'example.local']) assert.equal(isLoopbackHost(host), false, host);
  });

  it('refuses to expose the dashboard without a long enough ACCESS_TOKEN', () => {
    assert.doesNotThrow(() => assertWebSecurity({ host: '127.0.0.1', accessToken: null }));
    assert.throws(() => assertWebSecurity({ host: '0.0.0.0', accessToken: null }), { code: 'CONFIG_ERROR' });
    assert.throws(() => assertWebSecurity({ host: '0.0.0.0', accessToken: 'corto' }), { code: 'CONFIG_ERROR' });
    assert.doesNotThrow(() => assertWebSecurity({ host: '0.0.0.0', accessToken: 'un-token-suficientemente-largo' }));
  });

  it('lists localhost and every non-internal IPv4 interface when bound to all interfaces', () => {
    const interfaces = {
      lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
      wifi: [
        { address: '192.168.1.20', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      eth: [{ address: '10.0.0.5', family: 4, internal: false }],
    };
    assert.deepEqual(listAccessUrls({ host: '0.0.0.0', port: 3000, interfaces: /** @type {any} */ (interfaces) }), {
      local: ['http://localhost:3000'],
      lan: ['http://192.168.1.20:3000', 'http://10.0.0.5:3000'],
      exposed: true,
    });
    assert.deepEqual(listAccessUrls({ host: '127.0.0.1', port: 3000, interfaces: /** @type {any} */ (interfaces) }), {
      local: ['http://localhost:3000', 'http://127.0.0.1:3000'],
      lan: [],
      exposed: false,
    });
  });
});

describe('access control helpers', () => {
  it('compares secrets in constant time and parses cookies', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('', 'abc'), false);
    assert.deepEqual(parseCookies('a=1; retreat_session=xyz%20; broken'), { a: '1', retreat_session: 'xyz ' });
  });
});

describe('rateLimit', () => {
  it('allows max requests per window and then reports retryAfterSeconds', () => {
    let now = 0;
    const limiter = rateLimit({ windowMs: 10_000, max: 2, name: 'test', now: () => now });
    const req = /** @type {any} */ ({ ip: '1.2.3.4', socket: {} });
    const res = /** @type {any} */ ({ setHeader() {} });
    const results = [];
    for (let i = 0; i < 3; i += 1) limiter(req, res, (error) => results.push(error ?? null));
    assert.equal(results[0], null);
    assert.equal(results[1], null);
    assert.equal(results[2].code, 'RATE_LIMITED');
    assert.equal(results[2].details.retryAfterSeconds, 10);
    now = 10_001;
    limiter(req, res, (error) => results.push(error ?? null));
    assert.equal(results[3], null);
  });
});

describe('SyncScheduler', () => {
  it('skips refused ticks quietly and does not start when the interval is 0', async () => {
    const calls = [];
    const scheduler = new SyncScheduler({
      intervalMinutes: 5,
      logger: new NullLogger(),
      getSyncUseCase: () => ({
        start: async () => {
          calls.push('start');
          throw new AppError('SYNC_IN_PROGRESS', 409);
        },
      }),
    });
    await scheduler.tick();
    assert.deepEqual(calls, ['start']);

    const disabled = new SyncScheduler({ intervalMinutes: 0, logger: new NullLogger(), getSyncUseCase: () => ({ start: async () => ({ completion: Promise.resolve() }) }) });
    disabled.start();
    assert.equal(disabled.running, false);

    scheduler.start();
    assert.equal(scheduler.running, true);
    scheduler.stop();
    assert.equal(scheduler.running, false);
  });
});
