/**
 * LoggerPort adapter that discards everything (tests, silent scripts).
 * @implements {import('../../application/ports/LoggerPort.js').LoggerPort}
 */
export class NullLogger {
  debug() {}

  info() {}

  warn() {}

  error() {}

  /** @returns {NullLogger} */
  child() {
    return this;
  }
}
