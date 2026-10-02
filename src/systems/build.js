/**
 * build.js — every mutation of the tile grid goes through here.
 *
 * Placement, demolition and manual upgrades are the only ways a building
 * appears or disappears (event cards call into this module too). Keeping it
 * in one place means the save file, the renderer's dirty flags and the
 * particle system can never drift out of sync with the simulation.
 */

import { getDef, TIERS } from '../data/buildings.js';
import { canPlace } from './grid.js';
import { TERRAIN, inBounds, idx, } from '../core/state.js';
import { transfer } from './economy.js';
import { EV } from '../core/eventbus.js';

let nextId = 1;

/** Deterministic-ish instance id; reset from the save file on load. */
export function resetIds(n) { nextId = n; }

/* ── placement ──────────────────────────────────────────────────────────── */

/**
 * Place `defId` with its top-left at (x,y).
 * `opts.free` skips the cash charge (used by event rewards).
 * Returns `{ ok, reason, instances }`.
 */
export function place(state, defId, x, y, opts = {}) {
  const check = canPlace(state, defId, x, y);
  if (!check.ok) return check;

  const def = getDef(defId);
  if (!opts.free) {
    if (state.economy.cash < def.cost) return { ok: false, reason: 'Not enough funds' };
    transfer(state, -def.cost, 'construction');
  }

  const instances = [];
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      const i = idx(state, x + dx, y + dy);
      const inst = {
        id: nextId++,
        def: defId,
        tier: 1,
        variant: ((x * 7 + y * 13) % 3 + 3) % 3,
        occ: def.zone === 'residential' || def.zone === 'commercial' || def.zone === 'industrial' ? 0 : 1,
        powered: true,
        watered: true,
        svc: {},
        tickBuilt: state.tick,
        bornAt: performanceNow(),
        anchor: dx === 0 && dy === 0,
        ox: dx, oy: dy,
      };
      state.grid.buildings[i] = inst;
      instances.push(inst);
    }
  }

  state.stats.built++;
  state.dirty.sprites = true;
  emit(state, EV.BUILD, { x, y, defId, tier: 1, free: !!opts.free });
  return { ok: true, instances };
}

/* ── demolition ─────────────────────────────────────────────────────────── */

/**
 * Bulldoze whatever is at (x,y). Refunds 40% of construction cost for
 * structures; clearing raw terrain costs the bulldoze price.
 */
export function demolish(state, x, y, opts = {}) {
  if (!inBounds(state, x, y)) return { ok: false, reason: 'Off the map' };
  const i = idx(state, x, y);
  const b = state.grid.buildings[i];
  const tool = getDef('bulldoze');

  if (b) {
    const def = getDef(b.def);
    if (!opts.free && state.economy.cash < tool.cost) return { ok: false, reason: 'Not enough funds' };
    // Clear the whole footprint of a multi-tile building.
    const bx = x - (b.ox || 0), by = y - (b.oy || 0);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) state.grid.buildings[idx(state, bx + dx, by + dy)] = null;
    }
    if (!opts.free) {
      transfer(state, -tool.cost, 'demolition');
      transfer(state, def.cost * 0.4, 'scrap');
    }
    state.stats.demolished++;
    if (state.selection && state.selection.x === bx && state.selection.y === by) state.selection = null;
    state.dirty.sprites = true;
    emit(state, EV.DEMOLISH, { x: bx, y: by, defId: b.def });
    return { ok: true };
  }

  // Raw terrain: forest and rock can be cleared to grass.
  const t = state.grid.terrain[i];
  if (t === TERRAIN.WATER) return { ok: false, reason: 'You cannot bulldoze open water' };
  if (t === TERRAIN.GRASS || t === TERRAIN.SAND) return { ok: false, reason: 'Nothing to clear' };
  if (!opts.free && state.economy.cash < tool.cost) return { ok: false, reason: 'Not enough funds' };
  if (!opts.free) transfer(state, -tool.cost, 'demolition');
  state.grid.terrain[i] = TERRAIN.GRASS;
  state.dirty.terrain = true;
  emit(state, EV.DEMOLISH, { x, y, defId: null, terrain: true });
  return { ok: true };
}

/**
 * Remove one building instance and its whole footprint.
 *
 * Multi-tile structures occupy every tile of their rect, but only the anchor
 * tile is authoritative. Nulling a single tile leaves orphans that still
 * supply power, still charge upkeep and still block placement -- so every
 * removal path in the game must go through here.
 */
export function removeInstance(state, x, y) {
  if (!inBounds(state, x, y)) return null;
  const i = idx(state, x, y);
  const b = state.grid.buildings[i];
  if (!b) return null;
  const def = getDef(b.def);
  const bx = x - (b.ox || 0);
  const by = y - (b.oy || 0);
  for (let dy = 0; dy < def.h; dy++) {
    for (let dx = 0; dx < def.w; dx++) {
      state.grid.buildings[idx(state, bx + dx, by + dy)] = null;
    }
  }
  state.dirty.sprites = true;
  return { def: b.def, x: bx, y: by };
}

/* ── manual upgrade ─────────────────────────────────────────────────────── */

export function upgradeCost(state, x, y) {
  const b = state.grid.buildings[idx(state, x, y)];
  if (!b || !b.anchor) return null;
  const def = getDef(b.def);
  if (!def || b.tier >= def.tiers) return null;
  return Math.round(def.cost * TIERS.UPGRADE_COST[b.tier - 1]);
}

/** Player-driven tier up. Automatic growth also upgrades for free (zoning.js). */
export function upgrade(state, x, y) {
  const i = idx(state, x, y);
  const b = state.grid.buildings[i];
  if (!b || !b.anchor) return { ok: false, reason: 'Nothing to upgrade' };
  const def = getDef(b.def);
  if (b.tier >= def.tiers) return { ok: false, reason: 'Already at maximum tier' };
  const cost = Math.round(def.cost * TIERS.UPGRADE_COST[b.tier - 1]);
  if (state.economy.cash < cost) return { ok: false, reason: 'Not enough funds' };
  transfer(state, -cost, 'upgrade');
  b.tier++;
  b.variant = (b.variant + 1) % 3;
  b.upgradedAt = state.tick;
  b.bornAt = performanceNow();
  state.dirty.sprites = true;
  emit(state, EV.BUILD, { x, y, defId: b.def, tier: b.tier, upgrade: true });
  return { ok: true, cost };
}

/* ── drag helpers ───────────────────────────────────────────────────────── */

/**
 * Bresenham line of tiles for drag-building roads and zones.
 * Returns tile coordinates, de-duplicated, in draw order.
 */
export function lineTiles(x0, y0, x1, y1) {
  const out = [];
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  const seen = new Set();
  for (let guard = 0; guard < 512; guard++) {
    const key = y * 1000 + x;
    if (!seen.has(key)) { seen.add(key); out.push({ x, y }); }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return out;
}

/** True when the structure may be dragged rather than single-clicked. */
export function isDraggable(defId) {
  const def = getDef(defId);
  return !!def && def.w === 1 && def.h === 1 && def.zone !== 'tool';
}

/* ── event support ──────────────────────────────────────────────────────── */

/** Find a random legal tile for `defId`, preferring tiles with road access. */
export function findSpot(state, defId, rng, roadTiles) {
  const def = getDef(defId);
  const w = state.grid.w, h = state.grid.h;
  const candidates = [];
  for (let y = 0; y <= h - def.h; y++) {
    for (let x = 0; x <= w - def.w; x++) {
      if (!canPlace(state, defId, x, y).ok) continue;
      if (state.economy.cash < 0) { /* canPlace ignores cost when free */ }
      let score = 1;
      if (roadTiles) {
        for (let dy = 0; dy < def.h; dy++) {
          for (let dx = 0; dx < def.w; dx++) {
            if (roadTiles.has((y + dy) * 1000 + (x + dx))) score += 4;
          }
        }
      }
      candidates.push({ x, y, score });
    }
  }
  if (!candidates.length) return null;
  // Weighted pick biased toward well-connected tiles.
  let total = 0;
  for (const c of candidates) total += c.score;
  let r = rng.next() * total;
  for (const c of candidates) { r -= c.score; if (r <= 0) return c; }
  return candidates[candidates.length - 1];
}

/** Set of tile keys adjacent to a road, for findSpot's scoring. */
export function roadKeySet(state) {
  const set = new Set();
  const b = state.grid.buildings;
  const w = state.grid.w;
  for (let i = 0; i < b.length; i++) {
    const bl = b[i];
    if (!bl || (bl.def !== 'road' && bl.def !== 'boulevard')) continue;
    const x = i % w, y = (i / w) | 0;
    set.add(y * 1000 + x);
    set.add(y * 1000 + x + 1); set.add(y * 1000 + x - 1);
    set.add((y + 1) * 1000 + x); set.add((y - 1) * 1000 + x);
  }
  return set;
}

/* ── internals ──────────────────────────────────────────────────────────── */

function emit(state, type, payload) {
  if (state.bus) state.bus.emit(type, payload);
}

/** `performance.now()` in the browser, a monotonic counter in Node. */
function performanceNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
