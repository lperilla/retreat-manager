import { MongoClient } from 'mongodb';

import { describeError } from '../../../application/services/errorDescription.js';
import { AppError } from '../../../domain/errors.js';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Credential-free description of a MongoDB URI for logs: scheme and host list only
 * ("mongodb://127.0.0.1:27017"). Never log the raw URI.
 * @param {string} uri
 * @returns {string}
 */
export function describeMongoTarget(uri) {
  const match = /^(mongodb(?:\+srv)?):\/\/(?:[^@/]*@)?([^/?]*)/i.exec(String(uri ?? ''));
  return match ? `${match[1]}://${match[2]}` : 'mongodb://<invalid uri>';
}

/**
 * @param {string} uri
 * @returns {{ hasCredentials: boolean, hosts: string[] }}
 */
export function inspectMongoUri(uri) {
  const match = /^mongodb(?:\+srv)?:\/\/(?:([^@/]*)@)?([^/?]*)/i.exec(String(uri ?? ''));
  if (!match) return { hasCredentials: false, hosts: [] };
  const hosts = match[2]
    .split(',')
    .map((host) => host.replace(/:\d+$/, '').toLowerCase())
    .filter(Boolean);
  return { hasCredentials: Boolean(match[1]), hosts };
}

/**
 * Connects to MongoDB and verifies the connection with a ping.
 * Works with a local server, Atlas (mongodb+srv) and compatible servers.
 * @param {{
 *   uri: string,
 *   dbName: string,
 *   logger: import('../../../application/ports/LoggerPort.js').LoggerPort,
 *   appName?: string,
 *   serverSelectionTimeoutMS?: number,
 * }} options
 * @returns {Promise<{ client: MongoClient, db: import('mongodb').Db }>}
 */
export async function connectMongo({ uri, dbName, logger, appName = 'retreat-manager', serverSelectionTimeoutMS = 5000 }) {
  if (!uri) {
    throw new AppError('CONFIG_ERROR', 500, undefined, { variable: 'MONGODB_URI', reason: 'is required when PERSISTENCE=mongo' });
  }
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    throw new AppError('CONFIG_ERROR', 500, undefined, { variable: 'MONGODB_URI', reason: 'must start with mongodb:// or mongodb+srv://' });
  }
  if (!dbName) {
    throw new AppError('CONFIG_ERROR', 500, undefined, { variable: 'MONGODB_DB', reason: 'is required' });
  }

  const target = describeMongoTarget(uri);
  const { hasCredentials, hosts } = inspectMongoUri(uri);
  if (!hasCredentials) {
    logger.warn({ target }, 'MongoDB URI has no credentials; the server should require authentication');
  }
  if (hosts.some((host) => !LOOPBACK_HOSTS.has(host)) && !uri.toLowerCase().startsWith('mongodb+srv://')) {
    logger.warn({ target }, 'MongoDB is not on a loopback address; make sure it is not exposed publicly');
  }

  const client = new MongoClient(uri, { appName, serverSelectionTimeoutMS, ignoreUndefined: true });
  try {
    await client.connect();
    await client.db(dbName).command({ ping: 1 });
  } catch (error) {
    await client.close().catch(() => {});
    throw new AppError('DATABASE_UNAVAILABLE', 503, undefined, { target, reason: describeError(error) });
  }
  logger.info({ target, db: dbName }, 'Connected to MongoDB');
  return { client, db: client.db(dbName) };
}
