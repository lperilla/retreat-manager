import pino from 'pino';

/** Field paths whose values are always masked in log output. */
export const REDACTED_PATHS = Object.freeze([
  'uri',
  'mongodbUri',
  'mongoUri',
  'accessToken',
  'token',
  'refreshToken',
  'password',
  'clientSecret',
  'authorization',
  '*.uri',
  '*.mongodbUri',
  '*.mongoUri',
  '*.accessToken',
  '*.token',
  '*.refreshToken',
  '*.password',
  '*.clientSecret',
  '*.authorization',
  'headers.authorization',
  'req.headers.authorization',
  'req.headers.cookie',
]);

/**
 * LoggerPort adapter backed by pino (JSON lines).
 * Use `destination: 'stderr'` when stdout must stay clean.
 * @implements {import('../../application/ports/LoggerPort.js').LoggerPort}
 */
export class PinoLogger {
  /** @type {import('pino').Logger} */
  #logger;

  /**
   * @param {import('pino').Logger} logger
   */
  constructor(logger) {
    this.#logger = logger;
  }

  /**
   * @param {{ level?: string, destination?: 'stdout' | 'stderr', file?: string | null, bindings?: Record<string, unknown> }} [options]
   *        `file` writes the log lines to that file (created with its folders) instead of the console.
   * @returns {PinoLogger}
   */
  static create({ level = 'info', destination = 'stdout', file = null, bindings = {} } = {}) {
    const stream = file
      ? pino.destination({ dest: file, sync: true, mkdir: true })
      : pino.destination({ dest: destination === 'stderr' ? 2 : 1, sync: true });
    const logger = pino(
      {
        level,
        base: { pid: process.pid, ...bindings },
        redact: { paths: [...REDACTED_PATHS], censor: '[REDACTED]' },
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      stream,
    );
    return new PinoLogger(logger);
  }

  /**
   * @param {'debug' | 'info' | 'warn' | 'error'} level
   * @param {Record<string, unknown> | string} fieldsOrMessage
   * @param {string} [message]
   */
  #log(level, fieldsOrMessage, message) {
    if (typeof fieldsOrMessage === 'string') this.#logger[level](fieldsOrMessage);
    else this.#logger[level](fieldsOrMessage ?? {}, message);
  }

  /** @type {import('../../application/ports/LoggerPort.js').LogMethod} */
  debug(fieldsOrMessage, message) {
    this.#log('debug', fieldsOrMessage, message);
  }

  /** @type {import('../../application/ports/LoggerPort.js').LogMethod} */
  info(fieldsOrMessage, message) {
    this.#log('info', fieldsOrMessage, message);
  }

  /** @type {import('../../application/ports/LoggerPort.js').LogMethod} */
  warn(fieldsOrMessage, message) {
    this.#log('warn', fieldsOrMessage, message);
  }

  /** @type {import('../../application/ports/LoggerPort.js').LogMethod} */
  error(fieldsOrMessage, message) {
    this.#log('error', fieldsOrMessage, message);
  }

  /**
   * @param {Record<string, unknown>} bindings
   * @returns {PinoLogger}
   */
  child(bindings) {
    return new PinoLogger(this.#logger.child(bindings));
  }
}
