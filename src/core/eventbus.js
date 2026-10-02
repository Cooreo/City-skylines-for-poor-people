/**
 * eventbus.js — decoupled pub/sub.
 *
 * Systems publish; UI and the renderer subscribe. Nothing in src/systems/ or
 * src/data/ imports from src/ui/ or src/render/ — the dependency arrow only
 * ever points inward. See docs/02-ARCHITECTURE.md.
 */

export function createBus() {
  const map = new Map();
  return {
    on(type, fn) {
      let set = map.get(type);
      if (!set) { set = new Set(); map.set(type, set); }
      set.add(fn);
      return () => set.delete(fn);
    },
    once(type, fn) {
      const off = this.on(type, (payload) => { off(); fn(payload); });
      return off;
    },
    off(type, fn) {
      const set = map.get(type);
      if (set) set.delete(fn);
    },
    emit(type, payload) {
      const set = map.get(type);
      if (!set || set.size === 0) return;
      // Copy so a handler may unsubscribe during dispatch.
      for (const fn of [...set]) {
        try { fn(payload); } catch (err) { console.error(`[bus:${type}]`, err); }
      }
    },
    clear() { map.clear(); },
  };
}

/** Canonical channel names — keep this list and the emitters in sync. */
export const EV = Object.freeze({
  TICK: 'tick',                 // payload: {tick, day, season}
  STATE: 'state',               // payload: state  (after any mutation)
  CASH: 'cash',                 // payload: {cash, delta, reason}
  BUILD: 'build',               // payload: {x, y, defId, tier}
  DEMOLISH: 'demolish',         // payload: {x, y, defId}
  SELECTION: 'selection',       // payload: {x, y} | null
  TOOL: 'tool',                 // payload: {toolId}
  MILESTONE: 'milestone',       // payload: {pop, title, text, reward}
  EVENT_SHOW: 'event:show',     // payload: event def
  EVENT_RESOLVE: 'event:resolve', // payload: {eventId, choiceIndex, result}
  TOAST: 'toast',               // payload: {text, tone, ttl}
  UNLOCK: 'unlock',             // payload: {defId, label}
  VICTORY: 'victory',           // payload: {medals, stats}
  SAVE: 'save',
  LOAD: 'load',
  ZOOM: 'zoom',                 // payload: {zoom}
  SPEED: 'speed',               // payload: {speed}
});
