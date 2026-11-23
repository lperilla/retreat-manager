import { spawn } from 'node:child_process';

/**
 * Best-effort: opens a URL in the default browser of THIS computer (the server).
 * @param {string} url
 */
export function openBrowser(url) {
  const command =
    process.platform === 'win32'
      ? { file: 'rundll32', args: ['url.dll,FileProtocolHandler', url] }
      : process.platform === 'darwin'
        ? { file: 'open', args: [url] }
        : { file: 'xdg-open', args: [url] };
  try {
    const child = spawn(command.file, command.args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The caller also shows the URL.
  }
}
