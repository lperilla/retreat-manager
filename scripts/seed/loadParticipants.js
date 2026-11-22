/**
 * Loads the test participants (with their full profiles) into the active retreat of the
 * configured store, for demos with the Gmail test letters (`seed-gmail.js --load-participants`).
 *
 * The retreat's participant list is REPLACED: participants that are not in the test set are
 * removed and their room and table assignments released. The caller backs up `previous` first.
 */
import { slugify } from '../../src/domain/entities/Participant.js';
import { getOrCreateActiveRetreat } from '../../src/modules/participants/application/activeRetreat.js';
import { createParticipantRecord } from '../../src/modules/participants/domain/ParticipantRecord.js';
import { SEED_PARTICIPANTS } from './catalog.js';

/**
 * Validated records of the test participants for a retreat (ids = slugs of the display names,
 * the same ids the letter expectations use).
 * @param {{ retreatId: string, now: Date }} context
 * @returns {import('../../src/modules/participants/domain/ParticipantRecord.js').ParticipantRecord[]}
 */
export function seedParticipantRecords({ retreatId, now }) {
  return SEED_PARTICIPANTS.map((participant) =>
    createParticipantRecord({
      ...participant.profile,
      id: slugify(participant.displayName),
      retreatId,
      createdAt: now,
      updatedAt: now,
      attendanceConfirmedAt: participant.profile.attendanceConfirmed ? now : null,
    }),
  );
}

/**
 * Participants currently stored in the active retreat (for the backup and the confirmation).
 * @param {{ persistence: { retreats: any, participantRecords: any }, now: Date }} context
 */
export async function currentParticipants({ persistence, now }) {
  const retreat = await getOrCreateActiveRetreat(persistence.retreats, { now });
  return { retreat, participants: await persistence.participantRecords.findByRetreat(retreat.id) };
}

/**
 * Replaces the active retreat's participants with the test set.
 * @param {{ persistence: { retreats: any, participantRecords: any, roomAssignments: any, tableAssignments: any }, now: Date }} context
 * @returns {Promise<{ retreatId: string, loaded: number, removed: string[] }>}
 */
export async function loadSeedParticipants({ persistence, now }) {
  const { retreat, participants: previous } = await currentParticipants({ persistence, now });
  const records = seedParticipantRecords({ retreatId: retreat.id, now });
  await persistence.participantRecords.replaceForRetreat(retreat.id, records);
  const kept = new Set(records.map((record) => record.id));
  const removed = previous.map((/** @type {{ id: string }} */ p) => p.id).filter((id) => !kept.has(id));
  for (const id of removed) {
    await persistence.roomAssignments.deleteByParticipant(id);
    await persistence.tableAssignments.deleteByParticipant(id);
  }
  return { retreatId: retreat.id, loaded: records.length, removed };
}
