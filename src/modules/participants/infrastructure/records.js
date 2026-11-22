import { COLLATION_LOCALE } from '../../../domain/constants.js';
import { createParticipantRecord, splitFullName } from '../domain/ParticipantRecord.js';

/**
 * @template {{ id: string, displayName: string }} T
 * @param {readonly T[]} records
 * @returns {T[]}
 */
export function sortRecordsByName(records) {
  return [...records].sort(
    (a, b) => a.displayName.localeCompare(b.displayName, COLLATION_LOCALE, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/**
 * Converts an old-style participant ({ id, displayName, aliases }: participants file,
 * previous database documents, demo data, tests) into a record of the given retreat.
 * The name is split automatically; ambiguous splits are flagged for review, and the full
 * name keeps matching letters exactly as before.
 * @param {{ id: string, displayName: string, aliases?: readonly string[], nameParts?: any, status?: string }} legacy
 * @param {{ retreatId: string, now: Date, existing?: import('../domain/ParticipantRecord.js').ParticipantRecord | null }} context
 * @returns {import('../domain/ParticipantRecord.js').ParticipantRecord}
 */
export function legacyToRecord(legacy, { retreatId, now, existing = null }) {
  const parts = legacy.nameParts?.givenNames
    ? { ...legacy.nameParts, needsReview: false }
    : splitFullName(legacy.displayName);
  return createParticipantRecord({
    ...(existing ?? {}),
    id: legacy.id,
    retreatId,
    givenNames: parts.givenNames,
    firstSurname: parts.firstSurname,
    secondSurname: parts.secondSurname,
    aliases: [...(legacy.aliases ?? [])],
    status: /** @type {any} */ (legacy.status ?? existing?.status ?? 'active'),
    nameNeedsReview: existing ? existing.nameNeedsReview : parts.needsReview,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  });
}
