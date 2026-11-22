import { randomUUID } from 'node:crypto';

import { RetreatStatus, createRetreat } from '../domain/Retreat.js';

/**
 * Returns the active retreat, creating the first one ("Retiro", no dates) when none exists.
 * Every participant, letter and print status belongs to the active retreat.
 * @param {import('./ports.js').RetreatRepositoryPort} retreats
 * @param {{ now: Date, idGenerator?: () => string }} context
 * @returns {Promise<import('../domain/Retreat.js').Retreat>}
 */
export async function getOrCreateActiveRetreat(retreats, { now, idGenerator = randomUUID }) {
  const active = await retreats.findActive();
  if (active) return active;
  const retreat = createRetreat({ id: idGenerator(), name: 'Retiro', status: RetreatStatus.ACTIVE, createdAt: now });
  await retreats.save(retreat);
  // Two processes starting together may both create one: keep the oldest.
  const winner = await retreats.findActive();
  return winner ?? retreat;
}
