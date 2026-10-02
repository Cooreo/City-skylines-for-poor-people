/**
 * rng.js — deterministic, serialisable pseudo-random number generator.
 *
 * Every random decision in the simulation goes through here so a save file can
 * reproduce its future exactly (and so the headless test harness can assert on
 * specific outcomes). mulberry32: tiny, fast, good enough for a city builder.
 */

export function createRng(seed = 0x2f6e2b1) {
  let s = seed >>> 0;
  return {
    get state() { return s; },
    set state(v) { s = v >>> 0; },
    /** float in [0,1) */
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    /** float in [min,max) */
    range(min, max) { return min + this.next() * (max - min); },
    /** integer in [min,max] inclusive */
    int(min, max) { return Math.floor(this.range(min, max + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; },
    chance(p) { return this.next() < p; },
    /** Fisher–Yates, in place. */
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
      }
      return arr;
    },
  };
}

/** Cheap non-serialisable hash used for cosmetic per-tile jitter. */
export function hash2(x, y) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
