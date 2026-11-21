/**
 * Runs the demo end to end without a web server: builds a demo container (in-memory
 * stores + DemoMailSource), performs the three demo syncs and prints what the dashboard
 * would show after each one.
 *
 * Usage: node scripts/demo-walkthrough.js
 */
import { createContainer } from '../src/composition/container.js';
import { loadConfig } from '../src/composition/config.js';
import { NullLogger } from '../src/infrastructure/logging/NullLogger.js';

const config = loadConfig({ ...process.env, DEMO_MODE: 'true', SYNC_MIN_INTERVAL_SECONDS: '0' });
const container = await createContainer({ config, role: 'cli', overrides: { logger: new NullLogger() } });
const { useCases } = container;

/** @param {Array<{ displayName: string }>} list */
const names = (list) => list.map((p) => p.displayName).join(', ') || '-';

for (let wave = 1; wave <= 4; wave += 1) {
  const result = await useCases.syncMailbox.execute({ mode: 'incremental' });
  const { kpis } = await useCases.getDashboardOverview.execute();
  console.log(`\nSync #${wave} (${result.mode}): +${result.added} added, ${result.updated} updated, ${result.deleted} deleted`);
  for (const delta of result.perParticipantDeltas) console.log(`  +${delta.newLetters} ${delta.participantId}`);
  console.log(`  total letters: ${kpis.totalLetters}`);
  console.log(`  participants with letters: ${kpis.participantsWithLetters}/${kpis.participantCount}`);
  console.log(`  most letters (${kpis.mostLetters.count}): ${names(kpis.mostLetters.participants)}`);
  console.log(`  fewest letters (${kpis.fewestLetters.count}): ${names(kpis.fewestLetters.participants)}`);
  console.log(`  review queue: ${kpis.reviewQueueSize}, new letters: ${kpis.newLettersCount}`);
}

const queue = await useCases.reviewAssignment.listQueue();
console.log('\nReview queue:');
for (const letter of queue.letters) {
  const suggestions = letter.assignment.suggestions.map((s) => s.displayName).join(' / ') || 'no suggestions';
  const flags = letter.flags.map((f) => f.type).join(', ') || 'no flags';
  console.log(`  ${letter.messageId} "${letter.subject}" → ${suggestions} [${flags}]`);
}

await container.close();
