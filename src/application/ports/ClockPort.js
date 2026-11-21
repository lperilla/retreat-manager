import { definePort } from './definePort.js';

/**
 * @typedef {Object} ClockPort
 * @property {() => Date} now
 */

export const ClockPort = definePort('ClockPort', ['now']);
