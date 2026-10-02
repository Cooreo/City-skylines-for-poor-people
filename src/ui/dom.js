/**
 * dom.js — tiny DOM helpers.
 *
 * The UI is plain DOM (not canvas, not a framework): a top bar, a build
 * palette, an inspector panel and a modal stack. DOM gives us accessibility,
 * text selection, CSS transitions and tooltips for free, and the canvas only
 * ever draws the city itself.
 */

/** querySelector with a clear failure. */
export const $ = (sel, root = document) => {
  const node = root.querySelector(sel);
  if (!node) throw new Error(`missing element: ${sel}`);
  return node;
};

/** Create an element with attributes and children in one call. */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Format a number with thousands separators. */
export const fmt = (n) => Math.round(n).toLocaleString('en-US');

/** Format money with a currency sign. */
export function money(n) {
  const v = Math.round(n);
  const sign = v < 0 ? '-' : '';
  return `${sign}\u00a4${Math.abs(v).toLocaleString('en-US')}`;
}

/** Signed money, for income and expense rows. */
export const signed = (n) => `${n >= 0 ? '+' : '-'}\u00a4${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** Clamp helper. */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Add a class for `ms`, then remove it. Used for toast animations. */
export function flash(node, cls, ms = 400) {
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), ms);
}
