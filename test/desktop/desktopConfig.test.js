import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  applyDefaults,
  clientUrls,
  lanAddresses,
  loadDesktopConfig,
  newAccessToken,
  saveDesktopConfig,
  serverDefaults,
} from '../../desktop/config.mjs';
import { loadConfig } from '../../src/composition/config.js';
import { assertWebSecurity } from '../../src/infrastructure/web/security/networkSecurity.js';

describe('desktop server settings', () => {
  it('uses JSON files, the network and the access code by default, but a .env value wins', () => {
    const env = { PERSISTENCE: 'mongo', MONGODB_URI: 'mongodb://127.0.0.1:27017', PORT: '' };
    applyDefaults(env, serverDefaults({ home: 'C:/datos', accessToken: 'x'.repeat(32) }));
    assert.equal(env.PERSISTENCE, 'mongo'); // chosen in .env
    assert.equal(env.PORT, '3000'); // empty → default
    assert.equal(env.HOST, '0.0.0.0');
    assert.equal(env.RETREAT_HOME, 'C:/datos');

    const plain = {};
    applyDefaults(plain, serverDefaults({ home: 'C:/datos', accessToken: newAccessToken() }));
    const config = loadConfig(plain, { rootDir: 'C:/datos' });
    assert.equal(config.persistence, 'json');
    assert.doesNotThrow(() => assertWebSecurity(config)); // the generated code is long enough for the network
  });

  it('keeps the access code between runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'desktop-'));
    try {
      const file = join(dir, 'desktop.json');
      assert.equal(loadDesktopConfig(file).accessToken, null);
      const code = newAccessToken();
      saveDesktopConfig(file, { accessToken: code });
      assert.equal(loadDesktopConfig(file).accessToken, code);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('shows the real network address first, then the computer name', () => {
    const addresses = lanAddresses({
      'vEthernet (WSL)': [{ family: 'IPv4', address: '172.20.48.1', internal: false }],
      'Wi-Fi': [
        { family: 'IPv4', address: '192.168.1.20', internal: false },
        { family: 'IPv6', address: 'fe80::1', internal: false },
      ],
      Loopback: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
      Ethernet: [{ family: 'IPv4', address: '169.254.10.2', internal: false }],
    });
    assert.deepEqual(addresses, ['192.168.1.20', '172.20.48.1']);
    const urls = clientUrls({ addresses, hostname: 'PC-SECRETARIA', port: 3000 });
    assert.equal(urls.main, 'http://192.168.1.20:3000');
    assert.equal(urls.all.at(-1), 'http://pc-secretaria:3000');
    assert.equal(clientUrls({ addresses: [], hostname: '', port: 3000 }).main, null);
  });
});
