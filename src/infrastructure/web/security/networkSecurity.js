import { networkInterfaces } from 'node:os';

import { AppError } from '../../../domain/errors.js';

/** Minimum length of ACCESS_TOKEN when the dashboard is exposed beyond loopback. */
export const MIN_ACCESS_TOKEN_LENGTH = 16;

/**
 * @param {string} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  const value = String(host ?? '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || /^127(?:\.\d{1,3}){3}$/.test(value);
}

/**
 * Refuses to start when HOST is not loopback and ACCESS_TOKEN is missing or too short.
 * @param {Pick<import('../../../composition/config.js').AppConfig, 'host' | 'accessToken'>} config
 */
export function assertWebSecurity(config) {
  if (isLoopbackHost(config.host)) return;
  if (!config.accessToken) {
    throw new AppError('CONFIG_ERROR', 500, undefined, {
      variable: 'ACCESS_TOKEN',
      reason: `is required when HOST (${config.host}) is not a loopback address`,
    });
  }
  if (config.accessToken.length < MIN_ACCESS_TOKEN_LENGTH) {
    throw new AppError('CONFIG_ERROR', 500, undefined, {
      variable: 'ACCESS_TOKEN',
      reason: `must have at least ${MIN_ACCESS_TOKEN_LENGTH} characters when the dashboard is exposed on the network`,
    });
  }
}

/**
 * URLs where the dashboard is reachable: localhost plus every non-internal IPv4 interface
 * when bound to all interfaces (or the specific host otherwise).
 * @param {{ host: string, port: number, interfaces?: ReturnType<typeof networkInterfaces> }} options
 * @returns {{ local: string[], lan: string[], exposed: boolean }}
 */
export function listAccessUrls({ host, port, interfaces = networkInterfaces() }) {
  const local = [`http://localhost:${port}`];
  if (isLoopbackHost(host)) {
    if (host !== 'localhost') local.push(`http://${host.includes(':') ? `[${host}]` : host}:${port}`);
    return { local, lan: [], exposed: false };
  }
  const bindAll = host === '0.0.0.0' || host === '::' || host === '';
  const lan = [];
  if (bindAll) {
    for (const entries of Object.values(interfaces ?? {})) {
      for (const entry of entries ?? []) {
        const family = typeof entry.family === 'number' ? (entry.family === 4 ? 'IPv4' : 'IPv6') : entry.family;
        if (family === 'IPv4' && !entry.internal) lan.push(`http://${entry.address}:${port}`);
      }
    }
  } else {
    lan.push(`http://${host.includes(':') ? `[${host}]` : host}:${port}`);
  }
  return { local: bindAll ? local : [], lan: [...new Set(lan)], exposed: true };
}
