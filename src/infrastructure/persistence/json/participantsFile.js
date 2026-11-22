import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { assertUniqueParticipantIds, createParticipant, slugify } from '../../../domain/entities/Participant.js';
import { AppError } from '../../../domain/errors.js';

/**
 * Reads the participants list from a JSON file. Accepted shapes:
 *   [{ "displayName": "María García", "aliases": ["Mari"], "id": "maria-garcia" }, …]
 *   { "participants": [ … ] }
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
  const list = Array.isArray(parsed) ? parsed : parsed?.participants;
  if (!Array.isArray(list)) {
    throw new AppError('CONFIG_ERROR', 500, undefined, { reason: 'participants file must contain an array' });
  }
  return assertUniqueParticipantIds(list.map((item) => createParticipant(item)));
}

/**
 * Writes the participants list back to the JSON file (same shape as the hand-written one:
 * `id` only when it differs from the one derived from the name). The previous file is kept
 * as `<file>.bak` and the new one is written atomically (temp file + rename).
 * @param {string} filePath
 * @param {readonly import('../../../domain/entities/Participant.js').Participant[]} participants
 */
export async function writeParticipantsFile(filePath, participants) {
  const list = participants.map((p) => ({
    ...(p.id !== slugify(p.displayName) ? { id: p.id } : {}),
    displayName: p.displayName,
    aliases: [...p.aliases],
  }));
  await mkdir(dirname(filePath), { recursive: true });
  await copyFile(filePath, `${filePath}.bak`).catch((error) => {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') throw error;
  });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(list, null, 2)}\n`, 'utf8');
  try {
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

/**
 * ParticipantListFilePort adapter for PARTICIPANTS_FILE.
 * @implements {import('../../../application/ports/ParticipantListFilePort.js').ParticipantListFilePort}
 */
export class ParticipantsJsonFile {
  #filePath;

  /** @param {string} filePath */
  constructor(filePath) {
    this.#filePath = filePath;
  }

  /** @param {readonly import('../../../domain/entities/Participant.js').Participant[]} participants */
  async write(participants) {
    await writeParticipantsFile(this.#filePath, participants);
  }
}
