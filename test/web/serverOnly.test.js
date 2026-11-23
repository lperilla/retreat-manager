import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isServerComputer, requireServerComputer } from '../../src/infrastructure/web/middleware/serverOnly.js';

const request = (/** @type {string | undefined} */ remoteAddress) => /** @type {any} */ ({ socket: { remoteAddress } });

describe('Configuración only on the server computer', () => {
  it('recognises the server computer by its loopback address, in IPv4, IPv6 and mapped form', () => {
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isServerComputer(request(address)), true, address);
    for (const address of ['192.168.1.20', '::ffff:192.168.1.20', 'fe80::1', '10.0.0.5', '', undefined]) {
      assert.equal(isServerComputer(request(address)), false, String(address));
    }
  });

  it('lets the server computer through and refuses every other device with SETTINGS_SERVER_ONLY', () => {
    const guard = requireServerComputer();
    /** @type {unknown[]} */
    const calls = [];
    guard(request('127.0.0.1'), /** @type {any} */ ({}), (error) => calls.push(error));
    guard(request('192.168.1.50'), /** @type {any} */ ({}), (error) => calls.push(error));
    assert.equal(calls[0], undefined);
    assert.equal(/** @type {any} */ (calls[1]).code, 'SETTINGS_SERVER_ONLY');
    assert.equal(/** @type {any} */ (calls[1]).httpStatus, 403);
  });
});
