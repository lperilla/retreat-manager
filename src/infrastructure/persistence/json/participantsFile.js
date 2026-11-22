import { readFile } from 'node:fs/promises';

import { assertUniqueParticipantIds, createParticipant } from '../../../domain/entities/Participant.js';
import { AppError } from '../../../domain/errors.js';

/**
 * Reads a participants list from a JSON file: imported ONCE into an empty retreat (the
 * participants module is the single source afterwards). Accepted shapes:
 *   [{ "displayName": "María García", "aliases": ["Mari"], "id": "maria-garcia" }, …]
 *   { "participants": [ … ] }
 *   { "documents": [ … ] }   (participants store written by older versions with PERSISTENCE=json)
 * `id` is optional (derived from the display name).
 * @param {string} filePath
 * @returns {Promise<import('../../../domain/entities/Participant.js').Participant[] | null>}
 *          null when the file does not exist.
 */
export async function readParticipantsFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
  } catch (error) {
    throw new AppError('CONFIG_ERROR', 500, undefined, {
      reason: `participants file is not valid JSON: ${/** @type {Error} */ (error).message}`,
    });
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.participants ?? parsed?.documents;
  if (!Array.isArray(list)) {
    throw new AppError('CONFIG_ERROR', 500, undefined, { reason: 'participants file must contain an array' });
  }
  return assertUniqueParticipantIds(list.map((item) => createParticipant(item)));
}

