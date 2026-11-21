/**
 * Safe DOM helpers. Dynamic text is ALWAYS inserted as text nodes (never innerHTML).
 */

/**
 * @param {string} selector
 * @param {ParentNode} [root]
 * @returns {HTMLElement}
 */
export function $(selector, root = document) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);
  return /** @type {HTMLElement} */ (element);
}

/**
 * Creates an element. Props: `class`, `text`, `dataset`, `on<Event>` handlers, boolean
 * attributes (true/false) and any other attribute (stringified). Children may be nodes,
 * strings (text nodes), arrays, or null/false (skipped).
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} children
 * @returns {HTMLElement}
 */
export function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'text') element.textContent = String(value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) element.setAttribute(key, '');
    else element.setAttribute(key, String(value));
  }
  append(element, children);
  return element;
}

/**
 * @param {HTMLElement} parent
 * @param {any[]} children
 */
function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/**
 * Removes all children (disposing Bootstrap tooltips first).
 * @param {HTMLElement} element
 * @param {...any} children  Optional new content.
 */
export function replaceChildren(element, ...children) {
  disposeTooltips(element);
  element.replaceChildren();
  append(element, children);
}

/**
 * @param {ParentNode} root
 */
export function enableTooltips(root) {
  const bootstrap = /** @type {any} */ (window).bootstrap;
  if (!bootstrap) return;
  for (const element of root.querySelectorAll('[data-bs-toggle="tooltip"]')) {
    bootstrap.Tooltip.getOrCreateInstance(element);
  }
}

/**
 * @param {ParentNode} root
 */
export function disposeTooltips(root) {
  const bootstrap = /** @type {any} */ (window).bootstrap;
  if (!bootstrap) return;
  for (const element of root.querySelectorAll('[data-bs-toggle="tooltip"]')) {
    bootstrap.Tooltip.getInstance(element)?.dispose();
  }
}

/**
 * @template {(...args: any[]) => void} F
 * @param {F} fn
 * @param {number} waitMs
 * @returns {F}
 */
export function debounce(fn, waitMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  return /** @type {F} */ ((...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  });
}

/**
 * Runs an async action with the button disabled (prevents double submissions).
 * @param {HTMLButtonElement | null} button
 * @param {() => Promise<unknown>} action
 */
export async function withBusy(button, action) {
  if (button) button.disabled = true;
  try {
    return await action();
  } finally {
    if (button) button.disabled = false;
  }
}
