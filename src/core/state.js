/**
 * state.js — the single mutable world state object.
 *
 * One plain-object tree, no classes, no getters, no hidden ownership. Every
 * system takes `state` as its first argument and mutates it in place. That is
 * what makes the headless simulation harness (test/sim.test.js) possible: the
 * entire game can run in Node with no DOM at all.
 *
 * Cosmetic agent pools (pedestrians, vehicles, particles) live outside this
 * object — they are derived, never saved.
 */

import { createRng } from './rng.js';

/* ── constants ──────────────────────────────────────────────────────────── */

export const SAVE_VERSION = 3;

export const GRID = Object.freeze({ w: 44, h: 44 });

/** Isometric tile dimensions in screen pixels at zoom 1. */
export const TILE_W = 64;
export const TILE_H = 32;

/** Terrain codes. Order matters: higher = drawn on top of lower in the map editor. */
export const TERRAIN = Object.freeze({ GRASS: 0, WATER: 1, SAND: 2, ROCK: 3, FOREST: 4 });
export const TERRAIN_NAMES = Object.freeze(['grass', 'water', 'sand', 'rock', 'forest']);

/** Side length, in tiles, of the guaranteed-buildable opening plot. */
export const STARTER_SIZE = 14;

/** Terrain a structure may be placed on without bulldozing first. */
export const BUILDABLE = new Set([TERRAIN.GRASS, TERRAIN.SAND]);

/* ── world generation ───────────────────────────────────────────────────── */

/**
 * Smooth value noise with bilinear interpolation. Deterministic for a seed,
 * which is what makes the map "single fixed map" rather than random: the
 * shipped seed never changes, so every player gets the same coastline.
 */
function valueNoise(w, h, seed) {
  const rng = createRng(seed);
  const cw = Math.ceil(w / 4) + 2;
  const ch = Math.ceil(h / 4) + 2;
  const lattice = new Float32Array(cw * ch);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();

  const smooth = (t) => t * t * (3 - 2 * t);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x / 4, fy = y / 4;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = smooth(fx - x0), ty = smooth(fy - y0);
      const a = lattice[y0 * cw + x0];
      const b = lattice[y0 * cw + x0 + 1];
      const c = lattice[(y0 + 1) * cw + x0];
      const d = lattice[(y0 + 1) * cw + x0 + 1];
      const top = a + (b - a) * tx;
      const bot = c + (d - c) * tx;
      out[y * w + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

/**
 * Builds the fixed map: a soft island with one meandering river, sandy shores,
 * two forest belts and a rocky ridge. Same seed ⇒ same map, forever.
 */
export function generateTerrain(w = GRID.w, h = GRID.h, seed = 1337) {
  const base = valueNoise(w, h, seed);
  const detail = valueNoise(w, h, seed + 77);
  const forestNoise = valueNoise(w, h, seed + 991);
  const terrain = new Int8Array(w * h);
  const height = new Float32Array(w * h);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const maxR = Math.min(w, h) / 2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Radial falloff turns the square into a rounded island.
      const nx = (x - cx) / maxR, ny = (y - cy) / maxR;
      const dist = Math.sqrt(nx * nx + ny * ny);
      const falloff = 1 - Math.pow(Math.min(1, dist / 1.02), 3.1);
      let e = base[i] * 0.62 + detail[i] * 0.38;
      e = e * 0.72 + falloff * 0.42;
      height[i] = e;

      if (e < 0.335) terrain[i] = TERRAIN.WATER;
      else if (e < 0.385) terrain[i] = TERRAIN.SAND;
      else if (e > 0.84 && detail[i] > 0.63) terrain[i] = TERRAIN.ROCK;
      else if (forestNoise[i] > 0.685 && e > 0.44 && e < 0.72) terrain[i] = TERRAIN.FOREST;
      else terrain[i] = TERRAIN.GRASS;
    }
  }

  carveRiver(terrain, height, w, h, seed);
  softenShores(terrain, w, h);
  const starter = clearStarterPlot(terrain, w, h, STARTER_SIZE);
  return { terrain, height, starter };
}


/**
 * Largest square that contains no water or rock, scored by how much of it is
 * already open grass. The starter plot is cleared there so turn one never
 * begins with "you cannot build here".
 */
export function findStarterArea(terrain, w = GRID.w, h = GRID.h, size = 14) {
  let best = null;
  for (let y = 0; y <= h - size; y++) {
    for (let x = 0; x <= w - size; x++) {
      let open = 0, bad = 0;
      for (let dy = 0; dy < size; dy++) {
        for (let dx = 0; dx < size; dx++) {
          const t = terrain[(y + dy) * w + (x + dx)];
          if (t === TERRAIN.WATER || t === TERRAIN.ROCK) { bad = 1; dy = size; break; }
          if (t === TERRAIN.GRASS) open++;
        }
        if (bad) break;
      }
      if (bad) continue;
      if (!best || open > best.open) best = { x, y, size, open };
    }
  }
  return best || { x: (w - size) >> 1, y: (h - size) >> 1, size, open: 0 };
}

/** Flatten forest to grass inside the starter plot. Returns the plot rect. */
export function clearStarterPlot(terrain, w = GRID.w, h = GRID.h, size = 14) {
  const area = findStarterArea(terrain, w, h, size);
  for (let dy = 0; dy < area.size; dy++) {
    for (let dx = 0; dx < area.size; dx++) {
      const i = (area.y + dy) * w + (area.x + dx);
      if (terrain[i] === TERRAIN.FOREST) terrain[i] = TERRAIN.GRASS;
    }
  }
  return area;
}

/** A single lazy sine river from the north-west shore to the south-east. */
function carveRiver(terrain, height, w, h, seed) {
  const rng = createRng(seed + 31337);
  const start = { x: w * 0.18, y: 1 };
  const end = { x: w * 0.82, y: h - 2 };
  const steps = h * 3;
  let px = start.x, py = start.y;
  const drift = rng.range(1.4, 2.6);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const targetX = start.x + (end.x - start.x) * t;
    const targetY = start.y + (end.y - start.y) * t;
    px += (targetX - px) * 0.08 + Math.sin(t * Math.PI * drift) * 0.55;
    py += (targetY - py) * 0.12;
    const width = 1.15 + Math.sin(t * Math.PI) * 0.7;
    const ix = Math.round(px), iy = Math.round(py);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = ix + dx, y = iy + dy;
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        if (dx * dx + dy * dy > width * width) continue;
        const i = y * w + x;
        terrain[i] = TERRAIN.WATER;
        height[i] = Math.min(height[i], 0.3);
      }
    }
  }
}

/** One erosion pass so water does not butt up against grass with no beach. */
function softenShores(terrain, w, h) {
  const copy = Int8Array.from(terrain);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (copy[i] !== TERRAIN.WATER) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const j = (y + dy) * w + (x + dx);
          if (copy[j] === TERRAIN.GRASS || copy[j] === TERRAIN.ROCK) terrain[j] = TERRAIN.SAND;
          if (copy[j] === TERRAIN.FOREST) terrain[j] = TERRAIN.GRASS;
        }
      }
    }
  }
}

/* ── state factory ──────────────────────────────────────────────────────── */

export function createState({ seed = 1337, cash = 12000 } = {}) {
  const { terrain, height, starter } = generateTerrain(GRID.w, GRID.h, seed);
  const n = GRID.w * GRID.h;

  return {
    version: SAVE_VERSION,
    seed,
    rngState: (seed * 2654435761) >>> 0,

    /* time */
    tick: 0,
    day: 1,
    /** 0..1 through the day; 0.0 = midnight, 0.25 = dawn, 0.5 = noon. */
    clock: 0.28,
    season: 'spring',
    /** 0 = paused, 1 = normal, 2 = fast, 3 = fastest. */
    speed: 1,

    /* world */
    grid: {
      w: GRID.w,
      h: GRID.h,
      terrain,
      height,
      buildings: new Array(n).fill(null),
    },

    camera: { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1 },
    /**
     * The guaranteed-buildable opening plot, as a rect (x,y = top-left).
     * The camera centres on `center`, which is derived from this.
     */
    starter: { x: starter.x, y: starter.y, size: starter.size },
    /** Camera focus at the start of a game: the middle of the starter plot. */
    center: { x: starter.x + (starter.size >> 1), y: starter.y + (starter.size >> 1) },

    /* economy */
    economy: {
      cash,
      income: 0,
      expense: 0,
      net: 0,
      taxLevel: 'normal',
      everDeficit: false,
      deficitStreak: 0,
      /** True once an emergency loan has been taken; gates the Solvent medal. */
      everEmergencyLoan: false,
      lastEmergencyAt: -999,
      loans: [],
      totalEarned: 0,
      totalSpent: 0,
      /** rolling 60-tick history for the budget sparkline */
      history: [],
    },

    /* aggregates recomputed by systems each tick */
    city: {
      pop: 0,
      housing: 0,
      jobs: 0,
      employed: 0,
      happiness: 55,
      zoneHappiness: { residential: 55, commercial: 55, industrial: 55 },
      pollution: 0,
      congestion: 0,
      powerSupply: 0,
      powerDemand: 0,
      powerRatio: 1,
      waterSupply: 0,
      waterDemand: 0,
      waterRatio: 1,
      coverage: { health: 0, education: 0, safety: 0, transit: 0 },
      demand: { residential: 0.5, commercial: 0.5, industrial: 0.5 },
      counts: {},
    },

    /* timed modifiers applied by events */
    modifiers: [],

    /* progression */
    unlocked: ['road', 'residential', 'commercial', 'industrial', 'park', 'powerPlant', 'waterTower', 'bulldoze', 'inspect'],
    seenMilestones: [],
    won: false,
    victoryMedals: [],

    /* event deck */
    deck: { cooldowns: {}, lastFired: -999, active: null, history: [] },

    /* player-facing stats */
    stats: { built: 0, demolished: 0, eventsResolved: 0, bestHappiness: 55, bestPop: 0 },

    settings: {
      showGrid: false,
      showCoverage: null,   // service key or null
      reduceMotion: false,
      autoSave: true,
    },

    /* transient, never saved */
    selection: null,
    tool: 'road',
    hover: null,
    dirty: { terrain: true, sprites: true },
  };
}

export const idx = (state, x, y) => y * state.grid.w + x;

export function inBounds(state, x, y) {
  return x >= 0 && y >= 0 && x < state.grid.w && y < state.grid.h;
}

export function tileAt(state, x, y) {
  if (!inBounds(state, x, y)) return null;
  const i = idx(state, x, y);
  return {
    x, y, i,
    terrain: state.grid.terrain[i],
    terrainName: TERRAIN_NAMES[state.grid.terrain[i]],
    building: state.grid.buildings[i],
  };
}

export function buildingAt(state, x, y) {
  if (!inBounds(state, x, y)) return null;
  return state.grid.buildings[idx(state, x, y)];
}

/** Every placed instance of `defId`. */
export function eachBuilding(state, fn) {
  const b = state.grid.buildings;
  for (let i = 0; i < b.length; i++) if (b[i]) fn(b[i], i);
}

export function countBuildings(state, defId) {
  let n = 0;
  const b = state.grid.buildings;
  for (let i = 0; i < b.length; i++) if (b[i] && b[i].def === defId) n++;
  return n;
}
