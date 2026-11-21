/**
 * `npm run db:purge`: permanently deletes letters, manual assignments, print status and sync
 * data (state + history) from the configured store, after an explicit confirmation.
 *
 * Options:
 *   --include-files         also delete EXPORT_DIR and CACHE_DIR
 *   --include-participants  also delete the stored participant list
 *   --yes                   skip the interactive confirmation (for scripts)
 */
import { createInterface } from 'node:readline/promises';

import { describeError } from '../application/services/errorDescription.js';
import { createPersistenceAdapters } from '../composition/container.js';
import { SystemClock } from '../infrastructure/clock/SystemClock.js';
import { NullLogger } from '../infrastructure/logging/NullLogger.js';
import { purgeData } from '../infrastructure/maintenance/purgeData.js';
import { describeMongoTarget } from '../infrastructure/persistence/mongo/MongoConnection.js';
import { PROJECT_ROOT, loadEnvironment } from './bootstrap.js';

const CONFIRMATION_WORD = 'PURGE';

/**
 * @param {string} text
 */
const say = (text) => process.stdout.write(`${text}\n`);

async function main() {
  const args = new Set(process.argv.slice(2));
  const known = new Set(['--include-files', '--include-participants', '--yes']);
  const unknown = [...args].filter((arg) => !known.has(arg));
  if (unknown.length > 0) {
    throw new Error(`Unknown option(s): ${unknown.join(', ')}. Valid: ${[...known].join(', ')}`);
  }

  const config = loadEnvironment();
  if (config.demoMode) {
    say('DEMO_MODE=true uses in-memory storage only: there is nothing to purge.');
    return;
  }

  const includeFiles = args.has('--include-files');
  const includeParticipants = args.has('--include-participants');
  const target =
    config.persistence === 'mongo' ? `${describeMongoTarget(config.mongo.uri)} (database "${config.mongo.db}")` : `${config.dataDir} (JSON files)`;

  say('This will PERMANENTLY delete:');
  say('  - all letters (including soft-deleted ones)');
  say('  - manual assignments, print status, sync state and sync history');
  if (includeParticipants) say('  - the participant list');
  if (includeFiles) say(`  - exported files in ${config.exportDir}\n  - cached attachments in ${config.cacheDir}`);
  say(`Store: ${target}`);
  say('Gmail is NOT modified (read-only access).');

  if (!args.has('--yes')) {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    // End of input (no TTY, Ctrl+D) counts as "no".
    const answer = await new Promise((resolve) => {
      prompt.once('close', () => resolve(''));
      prompt.question(`\nType ${CONFIRMATION_WORD} to continue: `).then(resolve, () => resolve(''));
    });
    prompt.close();
    process.stdout.write('\n');
    if (answer.trim() !== CONFIRMATION_WORD) {
      say('Aborted: nothing was deleted.');
      return;
    }
  }

  const persistence = await createPersistenceAdapters({ config, clock: new SystemClock(), logger: new NullLogger() });
  try {
    const report = await purgeData({
      persistence,
      includeParticipants,
      directories: includeFiles ? [config.exportDir, config.cacheDir] : [],
      projectRoot: PROJECT_ROOT,
    });
    say('\nDone:');
    say(`  letters deleted: ${report.letters}`);
    say(`  manual assignments deleted: ${report.overrides}`);
    say(`  print statuses deleted: ${report.printStatuses}`);
    say('  sync state and history deleted');
    if (report.participants !== null) say(`  participants deleted: ${report.participants}`);
    for (const { directory, removed } of report.directories) say(`  ${removed ? 'deleted' : 'not found'}: ${directory}`);
    say('\nRemember to revoke the app in your Google account and delete token.json if the retreat is over.');
  } finally {
    await persistence.close();
  }
}

main().catch((error) => {
  const details = /** @type {{ details?: unknown }} */ (error)?.details;
  process.stderr.write(`Purge failed: ${describeError(error)}${details ? ` ${JSON.stringify(details)}` : ''}\n`);
  process.exit(1);
});
