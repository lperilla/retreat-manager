import { definePort } from './definePort.js';

/**
 * Structured logger. Messages are in English; never log credentials or letter bodies.
 * Each method accepts either `(message)` or `(fields, message)`.
 *
 * @typedef {(fieldsOrMessage: Record<string, unknown> | string, message?: string) => void} LogMethod
 *
 * @typedef {Object} LoggerPort
 * @property {LogMethod} debug
 * @property {LogMethod} info
 * @property {LogMethod} warn
 * @property {LogMethod} error
 * @property {(bindings: Record<string, unknown>) => LoggerPort} child
 */

export const LoggerPort = definePort('LoggerPort', ['debug', 'info', 'warn', 'error', 'child']);
