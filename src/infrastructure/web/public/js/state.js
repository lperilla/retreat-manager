/**
 * Shared client state (single page).
 */
export const state = {
  /** @type {any} */
  info: null,
  /** Directory rows from the last dashboard load (unfiltered). @type {any[]} */
  participants: [],
  /** Selected participant ids. @type {Set<string>} */
  selection: new Set(),
  /** @type {any} */
  sync: null,
  /** "Incluir adjuntos" in exports and print views (default on). */
  includeAttachments: true,
  /** "Formato original": keep each e-mail's colours, fonts and sizes when printing (default on). */
  originalFormat: true,
};

/** @type {Map<string, Set<(detail?: any) => void>>} */
const listeners = new Map();

/**
 * @param {string} event
 * @param {(detail?: any) => void} listener
 */
export function on(event, listener) {
  const set = listeners.get(event) ?? new Set();
  set.add(listener);
  listeners.set(event, set);
}

/**
 * @param {string} event
 * @param {any} [detail]
 */
export function emit(event, detail) {
  for (const listener of listeners.get(event) ?? []) listener(detail);
}
