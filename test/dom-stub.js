/**
 * dom-stub.js — a minimal DOM + Canvas2D shim.
 *
 * There is no browser in CI, so the whole client boot path (app.js, the
 * renderer, the sprite cache, every UI panel) is exercised against this stub
 * instead of a real page. It cannot verify pixels, but it does verify that the
 * app *boots*, that a frame renders without throwing, and that the drawing
 * calls it makes are the ones we expect.
 *
 * Every Canvas2D method is a no-op that records its name, so the tests can
 * assert "we drew 300 buildings" rather than "it did not crash".
 */

const calls = { count: 0, byName: new Map(), drawImage: 0, fillText: 0 };

function makeCtx() {
  const noop = (name) => (...args) => {
    calls.count++;
    calls.byName.set(name, (calls.byName.get(name) || 0) + 1);
    if (name === 'drawImage') calls.drawImage++;
    if (name === 'fillText') calls.fillText++;
    return undefined;
  };
  const gradient = { addColorStop: noop('addColorStop') };
  const ctx = {
    canvas: null,
    save: noop('save'), restore: noop('restore'),
    translate: noop('translate'), rotate: noop('rotate'), scale: noop('scale'),
    setTransform: noop('setTransform'), resetTransform: noop('resetTransform'),
    clearRect: noop('clearRect'), fillRect: noop('fillRect'), strokeRect: noop('strokeRect'),
    beginPath: noop('beginPath'), closePath: noop('closePath'),
    moveTo: noop('moveTo'), lineTo: noop('lineTo'),
    arc: noop('arc'), ellipse: noop('ellipse'), rect: noop('rect'),
    bezierCurveTo: noop('bezierCurveTo'), quadraticCurveTo: noop('quadraticCurveTo'),
    fill: noop('fill'), stroke: noop('stroke'), clip: noop('clip'),
    fillText: noop('fillText'), strokeText: noop('strokeText'),
    measureText: () => ({ width: 10 }),
    setLineDash: noop('setLineDash'), getLineDash: () => [],
    drawImage: noop('drawImage'),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
    lineDashOffset: 0, shadowBlur: 0, shadowColor: 'transparent', shadowOffsetX: 0, shadowOffsetY: 0,
    filter: 'none', imageSmoothingEnabled: true,
  };
  return ctx;
}

/** Does `node` match a simple selector: `.class`, `#id`, `tag`, `tag.class`? */
function matches(node, sel) {
  if (!node || !(node instanceof Element)) return false;
  const m = /^([a-zA-Z][\w-]*)?(\.|#)([\w-]+)$/.exec(sel);
  if (m) {
    const [, tag, kind, name] = m;
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    return kind === '.'
      ? node.classList.contains(name)
      : node.getAttribute('id') === name;
  }
  const t = /^([a-zA-Z][\w-]*)$/.exec(sel);
  return !!t && node.tagName === t[1].toUpperCase();
}

/** Every descendant of `root` matching `sel`, in document order. */
function queryAll(root, sel) {
  const out = [];
  const walk = (node) => {
    for (const c of node.children || []) {
      if (!(c instanceof Element)) continue;
      if (matches(c, sel)) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

class Element {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.style = new Proxy({ setProperty() {}, removeProperty() {} }, {
      get: (t, k) => (k in t ? t[k] : ''),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    this.dataset = {};
    this.classList = {
      _set: new Set(),
      add: (...c) => c.forEach((x) => this.classList._set.add(x)),
      remove: (...c) => c.forEach((x) => this.classList._set.delete(x)),
      toggle: (c, on) => {
        const has = this.classList._set.has(c);
        const want = on === undefined ? !has : on;
        if (want) this.classList._set.add(c); else this.classList._set.delete(c);
        return want;
      },
      contains: (c) => this.classList._set.has(c),
    };
    this._text = '';
    this._className = '';
    this.width = 300; this.height = 150;
    this.clientWidth = 1280; this.clientHeight = 720;
  }

  /** className and classList must stay in sync, exactly as in a real DOM. */
  get className() { return this._className; }
  set className(v) {
    this._className = String(v);
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }

  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this._html = String(v); this.children = []; }

  append(...nodes) {
    for (const n of nodes) {
      if (n == null) continue;
      const node = n instanceof Element ? n : new TextNode(String(n));
      node.parentNode = this;
      this.children.push(node);
    }
  }
  appendChild(n) { this.append(n); return n; }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((c) => c !== this); }
  get firstChild() { return this.children[0] || null; }

  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  hasAttribute(k) { return k in this.attributes; }

  addEventListener(type, fn) { (this._listeners ||= {})[type] ||= []; this._listeners[type].push(fn); }
  removeEventListener(type, fn) {
    const l = (this._listeners || {})[type];
    if (l) this._listeners[type] = l.filter((f) => f !== fn);
  }
  dispatchEvent(e) {
    const l = (this._listeners || {})[e.type] || [];
    for (const fn of l) fn(e);
    return true;
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight }; }
  setPointerCapture() {}
  releasePointerCapture() {}
  focus() {}
  blur() {}
  closest() { return null; }
  matches(sel) { return matches(this, sel); }
  /** Depth-first search supporting `.class`, `#id`, `tag` and `tag.class`. */
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  getContext(kind) {
    this._ctx ||= makeCtx();
    this._ctx.canvas = this;
    return this._ctx;
  }
}

class TextNode {
  constructor(text) { this.text = String(text); this.parentNode = null; }
}

/* ── document / window ──────────────────────────────────────────────────── */

const root = new Element('html');
const body = new Element('body');
const head = new Element('head');
root.append(head, body);

const byId = new Map();
for (const id of ['city', 'hud-top', 'hud-bottom', 'inspector', 'budget', 'toasts', 'overlay']) {
  const node = new Element('div');
  node.setAttribute('id', id);
  byId.set(id, node);
  body.append(node);
}

export const document = {
  body,
  documentElement: root,
  head,
  readyState: 'complete',
  createElement: (tag) => new Element(tag),
  createTextNode: (t) => new TextNode(t),
  getElementById: (id) => byId.get(id) || null,
  querySelector: (sel) => {
    if (sel.startsWith('#')) return byId.get(sel.slice(1)) || null;
    return null;
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};

const windowListeners = {};
export const window = {
  document,
  devicePixelRatio: 1,
  innerWidth: 1280,
  innerHeight: 720,
  addEventListener: (type, fn) => { (windowListeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => {
    const l = windowListeners[type];
    if (l) windowListeners[type] = l.filter((f) => f !== fn);
  },
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  setTimeout, clearTimeout, setInterval, clearInterval,
};

const rafQueue = [];

/** localStorage stub backed by a Map. */
const store = new Map();
export const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i],
  get length() { return store.size; },
};

export const performance = { now: () => Number(process.hrtime.bigint() / 1000000n) };

/** Run `n` animation frames. */
export function runFrames(n, dtMs = 16) {
  for (let i = 0; i < n; i++) {
    const queue = rafQueue.splice(0, rafQueue.length);
    for (const fn of queue) fn(i * dtMs + dtMs);
  }
}

export function resetCalls() { calls.count = 0; calls.byName.clear(); calls.drawImage = 0; calls.fillText = 0; }

/** Wipe every stub store. Tests share one process, so isolation is explicit. */
export function resetAll() {
  resetCalls();
  store.clear();
  rafQueue.length = 0;
  const overlay = byId.get('overlay');
  if (overlay) { overlay.children = []; overlay._html = ''; }
  const toasts = byId.get('toasts');
  if (toasts) toasts.children = [];
}

/** Recursively collect text, so assertions can look inside nested panels. */
export function textOf(node) {
  if (!node) return '';
  if (node.text != null && node.children == null) return String(node.text);
  let out = node._text || '';
  for (const c of node.children || []) out += ' ' + textOf(c);
  return out;
}
export { calls };

/** Install the stubs on globalThis so ES modules see them. */
export function install() {
  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = localStorage;
  globalThis.performance = performance;
  globalThis.requestAnimationFrame = window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
  globalThis.Node = Element;
  return { document, window, localStorage, performance };
}
