import { rm, stat } from 'node:fs/promises';
import { parse, relative, resolve, isAbsolute } from 'node:path';

import { AppError } from '../../domain/errors.js';

/**
 * Refuses to delete a directory that is a filesystem root, the project root, or one of
 * its ancestors (protects against a misconfigured EXPORT_DIR / CACHE_DIR such as "." or "/").
 * @param {string} directory
 * @param {string} projectRoot
 * @returns {string} The resolved directory.
 */
export function assertSafeDirectory(directory, projectRoot) {
  const target = resolve(directory);
  const root = resolve(projectRoot);
  const isFilesystemRoot = parse(target).root === target;
  const relToTarget = relative(target, root);
  const containsProject = relToTarget === '' || (!relToTarget.startsWith('..') && !isAbsolute(relToTarget));
  if (isFilesystemRoot || containsProject) {
    throw new AppError('CONFIG_ERROR', 500, undefined, { reason: `refusing to delete unsafe directory "${target}"` });
  }
  return target;
}

/**
 * @typedef {Object} PurgeReport
 * @property {number} letters
 * @property {number} overrides
 * @property {number} printStatuses
 * @property {boolean} syncState
 * @property {number | null} participants  null when participants were kept.
 * @property {Array<{ directory: string, removed: boolean }>} directories
 */

/**
 * Permanently deletes letters, manual assignments, print status and sync data (state and
 * history). Optionally deletes participants and local directories (exports, attachment cache).
 * @param {{
 *   persistence: import('../persistence/json/createJsonPersistence.js').PersistenceAdapters,
 *   includeParticipants?: boolean,
 *   directories?: string[],
 *   projectRoot: string,
 * }} options
 * @returns {Promise<PurgeReport>}
 */
export async function purgeData({ persistence, includeParticipants = false, directories = [], projectRoot }) {
  const safeDirectories = directories.map((directory) => assertSafeDirectory(directory, projectRoot));

  const letters = await persistence.letterStore.deleteAll();
  const overrides = await persistence.overrideRepository.deleteAll();
  const printStatuses = await persistence.printStatusRepository.deleteAll();
  await persistence.syncStateRepository.deleteAll();
  const participants = includeParticipants ? await persistence.participantRepository.deleteAll() : null;

  const removedDirectories = [];
  for (const directory of safeDirectories) {
    const exists = await stat(directory).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (exists) await rm(directory, { recursive: true, force: true });
    removedDirectories.push({ directory, removed: exists });
  }

  return { letters, overrides, printStatuses, syncState: true, participants, directories: removedDirectories };
}
