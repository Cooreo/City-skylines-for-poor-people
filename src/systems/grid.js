/**
 * grid.js — tile geometry, road connectivity and pathfinding.
 *
 * The grid is a flat array indexed `y * w + x`. Everything here is pure
 * functions over `state` plus scratch buffers owned by the module, so the
 * per-tick cost is allocation-free after the first call.
 */

import { TERRAIN, BUILDABLE, inBounds, idx } from '../core/state.js';
import { getDef } from '../data/buildings.js';

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export { DIRS4 };

/* ── scratch buffers (grown on demand, reused every tick) ───────────────── */

let roadAccess = new Uint8Array(0);
let component = new Int16Array(0);
let visited = new Uint8Array(0);
let queue = new Int32Array(0);
let dist = new Int32Array(0);
let prev = new Int32Array(0);

function ensure(state) {
  const n = state.grid.w * state.grid.h;
  if (roadAccess.length !== n) {
    roadAccess = new Uint8Array(n);
    component = new Int16Array(n);
    visited = new Uint8Array(n);
    queue = new Int32Array(n);
    dist = new Int32Array(n);
    prev = new Int32Array(n);
  }
  return n;
}

export const isRoad = (state, x, y) => {
  if (!inBounds(state, x, y)) return false;
  const b = state.grid.buildings[idx(state, x, y)];
  return !!b && b.def === 'road';
};

/** True for road or boulevard. */
export const isCarriageway = (state, x, y) => {
  if (!inBounds(state, x, y)) return false;
  const b = state.grid.buildings[idx(state, x, y)];
  return !!b && (b.def === 'road' || b.def === 'boulevard');
};

/* ── road access ────────────────────────────────────────────────────────── */

/**
 * Marks every tile orthogonally adjacent to a carriageway. Buildings consult
 * `hasAccess(state,i)` — O(1) — instead of scanning neighbours each tick.
 */
export function computeRoadAccess(state) {
  const n = ensure(state);
  roadAccess.fill(0);
  const b = state.grid.buildings;
  const { w, h } = state.grid;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const bl = b[i];
      if (!bl) continue;
      if (bl.def !== 'road' && bl.def !== 'boulevard') continue;
      roadAccess[i] = 1;
      for (const [dx, dy] of DIRS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        roadAccess[ny * w + nx] = 1;
      }
    }
  }
  return roadAccess;
}

export function hasAccess(state, i) {
  ensure(state);
  return roadAccess[i] === 1;
}

export const roadAccessBuffer = () => roadAccess;

/* ── connected components ───────────────────────────────────────────────── */

/**
 * Labels each carriageway tile with the id of its connected component.
 * Returns `{ ids, sizes, largest }`. Used to warn about orphaned road spurs
 * and to keep traffic agents inside one component.
 */
export function computeComponents(state) {
  const n = ensure(state);
  component.fill(-1);
  const { w, h } = state.grid;
  const sizes = [0];
  let next = 0;
  let largest = 0;

  for (let start = 0; start < n; start++) {
    if (component[start] !== -1) continue;
    if (!isCarriageway(state, start % w, (start / w) | 0)) continue;
    const id = next++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    component[start] = id;
    while (head < tail) {
      const cur = queue[head++];
      const cx = cur % w, cy = (cur / w) | 0;
      sizes[id]++;
      for (const [dx, dy] of DIRS4) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (component[ni] !== -1) continue;
        if (!isCarriageway(state, nx, ny)) continue;
        component[ni] = id;
        queue[tail++] = ni;
      }
    }
    if (sizes[id] > largest) largest = sizes[id];
  }
  return { ids: component, sizes, largest, count: next };
}

export function componentAt(state, x, y) {
  ensure(state);
  if (!inBounds(state, x, y)) return -1;
  return component[idx(state, x, y)];
}

/* ── pathfinding ────────────────────────────────────────────────────────── */

/**
 * Breadth-first shortest path over carriageway tiles.
 * Returns an array of tile indices from `from` to `to`, or null.
 * BFS is right here: every road tile costs the same, so BFS is optimal and
 * roughly ten times cheaper than A* on a 44×44 grid.
 */
export function findRoadPath(state, from, to) {
  const n = ensure(state);
  const { w } = state.grid;
  if (from === to) return [from];
  if (!isCarriageway(state, from % w, (from / w) | 0)) return null;
  if (!isCarriageway(state, to % w, (to / w) | 0)) return null;

  visited.fill(0);
  dist.fill(-1);
  prev.fill(-1);
  let head = 0, tail = 0;
  queue[tail++] = from;
  visited[from] = 1;
  dist[from] = 0;
  let found = false;

  while (head < tail) {
    const cur = queue[head++];
    if (cur === to) { found = true; break; }
    const cx = cur % w, cy = (cur / w) | 0;
    for (const [dx, dy] of DIRS4) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= state.grid.w || ny >= state.grid.h) continue;
      const ni = ny * w + nx;
      if (visited[ni]) continue;
      if (!isCarriageway(state, nx, ny)) continue;
      visited[ni] = 1;
      dist[ni] = dist[cur] + 1;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (!found) return null;

  const path = [];
  for (let cur = to; cur !== -1; cur = prev[cur]) path.push(cur);
  path.reverse();
  return path;
}

/** All carriageway tile indices — cached per tick by the caller. */
export function collectRoadTiles(state, out = []) {
  out.length = 0;
  const b = state.grid.buildings;
  for (let i = 0; i < b.length; i++) {
    const bl = b[i];
    if (bl && (bl.def === 'road' || bl.def === 'boulevard')) out.push(i);
  }
  return out;
}

/* ── placement validation ───────────────────────────────────────────────── */

/**
 * Can `defId` be placed with its top-left at (x,y)?
 * Returns { ok, reason } so the UI can explain a rejection in a tooltip.
 */
export function canPlace(state, defId, x, y) {
  const def = getDef(defId);
  if (!def) return { ok: false, reason: 'Unknown structure' };
  if (!state.unlocked.includes(defId)) return { ok: false, reason: `Locked until ${def.unlockPop} citizens` };
  if (state.economy.cash < def.cost) return { ok: false, reason: 'Not enough funds' };

  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const tx = x + dx, ty = y + dy;
      if (!inBounds(state, tx, ty)) return { ok: false, reason: 'Off the map' };
      const i = idx(state, tx, ty);
      if (state.grid.buildings[i]) return { ok: false, reason: 'Tile is occupied' };
      const t = state.grid.terrain[i];
      if (!BUILDABLE.has(t)) {
        const name = t === TERRAIN.WATER ? 'water' : t === TERRAIN.ROCK ? 'rock' : 'forest';
        return { ok: false, reason: `Clear the ${name} first` };
      }
    }
  }
  return { ok: true };
}

/** Neighbours of a tile as {x,y,i} — allocated, so keep it out of hot loops. */
export function neighbors(state, x, y) {
  const out = [];
  for (const [dx, dy] of DIRS4) {
    const nx = x + dx, ny = y + dy;
    if (inBounds(state, nx, ny)) out.push({ x: nx, y: ny, i: idx(state, nx, ny) });
  }
  return out;
}

/** Chebyshev distance in tiles, used by service radii. */
export function tileDistance(ax, ay, bx, by) {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}
