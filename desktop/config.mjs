/**
 * Settings of the desktop server app and small pure helpers around them. No Electron imports
 * here, so they can be tested with node:test.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const DEFAULT_PORT = 3000;

/**
 * @typedef {Object} DesktopConfig
 * @property {string | null} accessToken  Access code the browsers of the other devices use.
 */

/**
 * @param {string} file
 * @returns {DesktopConfig}
 */
export function loadDesktopConfig(file) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return { accessToken: typeof saved.accessToken === 'string' && saved.accessToken.length >= 16 ? saved.accessToken : null };
  } catch {
    return { accessToken: null };
  }
}

/**
 * @param {string} file
 * @param {DesktopConfig} config
 */
export function saveDesktopConfig(file, config) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

/** Random access code (32 characters). */
export function newAccessToken() {
  return randomBytes(24).toString('base64url');
}

/**
 * Defaults of the desktop server: data in the user's profile, JSON files (no database to
 * install) and reachable from the local network, protected by the access code. They only fill
 * what is not already set, so a `.env` in the data folder can still choose MongoDB
 * (PERSISTENCE=mongo + MONGODB_URI), another port, etc.
 * @param {{ home: string, accessToken: string }} options
 * @returns {Record<string, string>}
 */
export function serverDefaults({ home, accessToken }) {
  return {
    RETREAT_HOME: home,
    PERSISTENCE: 'json',
    HOST: '0.0.0.0',
    PORT: String(DEFAULT_PORT),
    ACCESS_TOKEN: accessToken,
  };
}

/**
 * @param {Record<string, string | undefined>} env  Modified in place.
 * @param {Record<string, string>} defaults
 */
export function applyDefaults(env, defaults) {
  for (const [name, value] of Object.entries(defaults)) {
    if (env[name] === undefined || env[name] === '') env[name] = value;
  }
}

/** Adapters that are never the local network the other devices are on. */
const VIRTUAL_ADAPTER = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn|bluetooth/i;

/**
 * IPv4 addresses the other devices of the local network can use, best first: real adapters
 * before virtual ones, and home/office ranges (192.168.x, 10.x) before 172.16-31.x (often
 * Docker or Hyper-V).
 * @param {Record<string, Array<{ family: string | number, address: string, internal: boolean }> | undefined>} interfaces
 * @returns {string[]}
 */
export function lanAddresses(interfaces) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const item of list ?? []) {
      const ipv4 = item.family === 'IPv4' || item.family === 4;
      if (!ipv4 || item.internal || item.address.startsWith('169.254.')) continue;
      const score =
        (VIRTUAL_ADAPTER.test(name) ? 10 : 0) +
        (item.address.startsWith('192.168.') ? 0 : item.address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(item.address) ? 5 : 2);
      found.push({ address: item.address, score });
    }
  }
  return [...new Set(found.sort((a, b) => a.score - b.score).map((item) => item.address))];
}

/**
 * Addresses to give to the other devices: the main IP first, then the computer name (it keeps
 * working when the IP changes, on most home and office networks).
 * @param {{ addresses: string[], hostname: string, port: number }} options
 * @returns {{ main: string | null, all: string[] }}
 */
export function clientUrls({ addresses, hostname, port }) {
  const byIp = addresses.map((address) => `http://${address}:${port}`);
  const name = hostname ? [`http://${hostname.toLowerCase()}:${port}`] : [];
  const all = [...byIp, ...name];
  return { main: all[0] ?? null, all };
}
