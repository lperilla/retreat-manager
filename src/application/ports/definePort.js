/**
 * Ports are documented with JSDoc typedefs; at runtime each port is described by the
 * list of methods an adapter must implement, so the composition root can fail fast
 * with a clear message when an adapter is incomplete.
 */

/**
 * @typedef {Object} PortDefinition
 * @property {string}   name
 * @property {readonly string[]} methods
 * @property {readonly string[]} properties
 * @property {<T>(adapter: T) => T} assert  Throws TypeError when the adapter is incomplete.
 */

/**
 * @param {string} name
 * @param {readonly string[]} methods
 * @param {readonly string[]} [properties]  Required non-function members (e.g. `format`).
 * @returns {Readonly<PortDefinition>}
 */
export function definePort(name, methods, properties = []) {
  const frozenMethods = Object.freeze([...methods]);
  const frozenProperties = Object.freeze([...properties]);
  return Object.freeze({
    name,
    methods: frozenMethods,
    properties: frozenProperties,
    assert(adapter) {
      if (!adapter || (typeof adapter !== 'object' && typeof adapter !== 'function')) {
        throw new TypeError(`${name}: adapter is missing`);
      }
      const record = /** @type {Record<string, unknown>} */ (adapter);
      const missing = [
        ...frozenMethods.filter((method) => typeof record[method] !== 'function'),
        ...frozenProperties.filter((property) => record[property] === undefined || record[property] === null),
      ];
      if (missing.length > 0) {
        throw new TypeError(`${name}: adapter does not implement ${missing.join(', ')}`);
      }
      return adapter;
    },
  });
}
