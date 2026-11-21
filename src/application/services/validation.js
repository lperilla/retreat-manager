/**
 * Minimal input validation for use cases (web and MCP adapters validate too, but use
 * cases must not trust their callers). Errors are `VALIDATION_ERROR` (HTTP 400).
 */
import { AppError } from '../../domain/errors.js';

/**
 * @param {string} reason
 * @returns {AppError}
 */
function invalid(reason) {
  return new AppError('VALIDATION_ERROR', 400, undefined, { reason });
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min?: number, max?: number }} [limits]
 * @returns {string}
 */
export function requireString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') throw invalid(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw invalid(`${field} must have between ${min} and ${max} characters`);
  }
  return trimmed;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ allowEmpty?: boolean, max?: number }} [options]
 * @returns {string[]}
 */
export function requireStringArray(value, field, { allowEmpty = false, max = 1000 } = {}) {
  if (!Array.isArray(value)) throw invalid(`${field} must be an array`);
  if (!allowEmpty && value.length === 0) throw invalid(`${field} must not be empty`);
  if (value.length > max) throw invalid(`${field} must have at most ${max} items`);
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || item.length > 200) {
      throw invalid(`${field} must contain non-empty strings`);
    }
  }
  return [...new Set(value)];
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {{ min: number, max: number, fallback: number }} limits
 * @returns {number}
 */
export function integerInRange(value, field, { min, max, fallback }) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) {
    throw invalid(`${field} must be an integer between ${min} and ${max}`);
  }
  return number;
}

/**
 * @template {string} T
 * @param {unknown} value
 * @param {string} field
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
export function oneOf(value, field, allowed, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(/** @type {T} */ (value))) {
    throw invalid(`${field} must be one of ${allowed.join(', ')}`);
  }
  return /** @type {T} */ (value);
}
