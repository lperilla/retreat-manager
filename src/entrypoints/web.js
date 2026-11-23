/**
 * Web entrypoint (command line): dashboard + JSON API. The only command-line entrypoint that
 * schedules automatic syncs. The desktop app uses `startWeb` directly.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describeError } from '../application/services/errorDescription.js';
import { PROJECT_ROOT } from './bootstrap.js';
import { startWeb } from './startWeb.js';

/**
 * Restarting from the dashboard is only possible when start.cmd / start.sh launched this process
 * (it records the PID in .run/web.json); then the same script stops and starts it again.
 * @returns {(() => void) | null}
 */
function managedRestartHandler() {
  try {
    const info = JSON.parse(readFileSync(join(PROJECT_ROOT, '.run', 'web.json'), 'utf8'));
    if (info.pid !== process.pid) return null;
  } catch {
    return null; // Not started through start.cmd: no restart button.
  }
  return () => {
    const child = spawn(process.execPath, [join(PROJECT_ROOT, 'scripts', 'manage.js'), 'restart', '--no-open', '--no-mongo'], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
  };
}

async function main() {
  const web = await startWeb({ restartHandler: managedRestartHandler() });
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await web.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  const code = /** @type {{ code?: string, details?: unknown }} */ (error)?.code;
  const details = /** @type {{ details?: unknown }} */ (error)?.details;
  process.stderr.write(
    `retreat-manager web failed to start: ${describeError(error)}${details ? ` ${JSON.stringify(details)}` : ''}\n`,
  );
  process.exit(code === 'CONFIG_ERROR' ? 78 : 1);
});
