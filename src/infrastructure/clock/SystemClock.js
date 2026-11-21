/**
 * ClockPort adapter using the system time.
 * @implements {import('../../application/ports/ClockPort.js').ClockPort}
 */
export class SystemClock {
  /** @returns {Date} */
  now() {
    return new Date();
  }
}
