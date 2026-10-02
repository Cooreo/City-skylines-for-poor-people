/**
 * services.js — power, water, coverage radii and pollution.
 *
 * Runs first in the tick order because every downstream system reads
 * `b.powered`, `b.watered`, `b.svc` and `pollutionMap`.
 *
 * Rationing
 * ─────────
 * When supply < demand we do not sprinkle blackouts randomly: buildings are
 * walked in a stable order (spatially hashed) and the first N units of demand
 * are served. The result is a coherent dark district that moves only when the
 * player changes the network — which reads as "the grid is overloaded", not
 * "the game is being unfair".
 */

import { getDef, TIERS } from '../data/buildings.js';
import { idx, inBounds } from '../core/state.js';

const RATION_ORDER = (i) => ((i * 2654435761) >>> 11) % 100000;

let pollutionMap = new Float32Array(0);
let poweredSet = new Uint8Array(0);

function ensure(state) {
  const n = state.grid.w * state.grid.h;
  if (pollutionMap.length !== n) {
    pollutionMap = new Float32Array(n);
    poweredSet = new Uint8Array(n);
  }
  return n;
}

export const pollutionBuffer = () => pollutionMap;

/** Power draw of a single building instance at its current tier. */
export function powerDemandOf(b) {
  const def = getDef(b.def);
  if (!def) return 0;
  switch (def.id) {
    case 'road': case 'boulevard': case 'park': return 0;
    case 'plaza': return 1;
    case 'powerPlant': case 'solarFarm': return 3;
    case 'waterTower': return 1;
    case 'civic': return 5 * TIERS.CAPACITY[b.tier - 1];
    case 'stadium': return 8 * TIERS.CAPACITY[b.tier - 1];
    default: return 2 * TIERS.CAPACITY[b.tier - 1];
  }
}

export function waterDemandOf(b) {
  const def = getDef(b.def);
  if (!def) return 0;
  if (def.zone === 'residential' || def.zone === 'commercial' || def.zone === 'industrial') {
    return 1.5 * TIERS.CAPACITY[b.tier - 1];
  }
  if (def.id === 'road' || def.id === 'boulevard' || def.zone === 'park') return 0;
  return 1;
}

export function update(state, mods) {
  const n = ensure(state);
  const { w, h } = state.grid;
  const buildings = state.grid.buildings;
  pollutionMap.fill(0);

  let powerSupply = 0, waterSupply = 0, powerDemand = 0, waterDemand = 0;
  let healthCap = 0, eduCap = 0;

  const radii = { health: 0, education: 0, safety: 0, transit: 0 };
  const facilities = { health: [], education: [], safety: [], transit: [] };

  /* ── pass 1: totals + facility list ──────────────────────────────────── */
  for (let i = 0; i < n; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def) continue;

    if (def.service) {
      const cap = (def.service.capacity || 0) * TIERS.CAPACITY[b.tier - 1];
      const key = def.service.key;
      if (key === 'power') powerSupply += cap;
      else if (key === 'water') waterSupply += cap;
      else {
        const radius = def.service.radius * (1 + (b.tier - 1) * 0.15);
        radii[key] = Math.max(radii[key], radius);
        facilities[key].push({ i, x: i % w, y: (i / w) | 0, radius, capacity: cap });
        if (key === 'health') healthCap += cap;
        if (key === 'education') eduCap += cap;
      }
    }
    powerDemand += powerDemandOf(b);
    waterDemand += waterDemandOf(b);

    /* pollution spreads from industry and coal plants */
    if (def.pollution) {
      const strength = def.pollution * (3 + b.tier);
      const r = 4;
      const bx = i % w, by = (i / w) | 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = bx + dx, ty = by + dy;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > r) continue;
          pollutionMap[ty * w + tx] += strength * (1 - d / r);
        }
      }
    }
  }

  powerSupply *= mods.powerSupply;
  waterSupply *= mods.waterSupply;
  const powerRatio = powerDemand > 0 ? Math.min(1, powerSupply / powerDemand) : 1;
  const waterRatio = waterDemand > 0 ? Math.min(1, waterSupply / waterDemand) : 1;

  /* ── pass 2: ration power and water ──────────────────────────────────── */
  const budgetPower = powerSupply;
  const budgetWater = waterSupply;
  let usedPower = 0, usedWater = 0;

  const order = [];
  for (let i = 0; i < n; i++) if (buildings[i]) order.push(i);
  order.sort((a, b) => RATION_ORDER(a) - RATION_ORDER(b));

  for (const i of order) {
    const b = buildings[i];
    const pd = powerDemandOf(b);
    const wd = waterDemandOf(b);
    b.powered = pd === 0 || usedPower + pd <= budgetPower + 1e-6;
    b.watered = wd === 0 || usedWater + wd <= budgetWater + 1e-6;
    if (b.powered) usedPower += pd;
    if (b.watered) usedWater += wd;
  }

  /* ── pass 3: coverage radii over zoned tiles ─────────────────────────── */
  const zoneTiles = { residential: 0, commercial: 0, industrial: 0 };
  const covered = { health: 0, education: 0, safety: 0, transit: 0 };
  const zoneTotals = { health: 0, education: 0, safety: 0, transit: 0 };
  const coverageMap = { health: null, education: null, safety: null, transit: null };

  for (const key of Object.keys(facilities)) {
    if (!facilities[key].length) continue;
    const map = new Uint8Array(n);
    for (const f of facilities[key]) {
      const r = Math.ceil(f.radius);
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const tx = f.x + dx, ty = f.y + dy;
          if (!inBounds(state, tx, ty)) continue;
          if (Math.max(Math.abs(dx), Math.abs(dy)) > f.radius) continue;
          map[ty * w + tx] = 1;
        }
      }
    }
    coverageMap[key] = map;
  }

  for (let i = 0; i < n; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def) continue;
    b.svc = b.svc || {};

    for (const key of ['health', 'education', 'safety', 'transit']) {
      const map = coverageMap[key];
      const on = map ? map[i] === 1 : false;
      b.svc[key] = on;
      if (def.zone === 'residential' || def.zone === 'commercial' || def.zone === 'industrial') {
        zoneTotals[key]++;
        if (on) covered[key]++;
      }
    }

    if (def.zone === 'residential') zoneTiles.residential += b.occ || 0;
    if (def.zone === 'commercial') zoneTiles.commercial += b.occ || 0;
    if (def.zone === 'industrial') zoneTiles.industrial += b.occ || 0;
  }

  /* ── pass 4: park / plaza mood radii ─────────────────────────────────── */
  if (!moodMap || moodMap.length !== n) moodMap = new Float32Array(n);
  moodMap.fill(0);
  for (let i = 0; i < n; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def || !def.mood || !def.radius) continue;
    const r = def.radius + (b.tier - 1);
    const amount = def.mood * (1 + (b.tier - 1) * 0.18);
    const bx = i % w, by = (i / w) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = bx + dx, ty = by + dy;
        if (!inBounds(state, tx, ty)) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        moodMap[ty * w + tx] += amount * (1 - (d / r) * 0.55);
      }
    }
  }

  /* ── publish ─────────────────────────────────────────────────────────── */
  state.city.powerSupply = powerSupply;
  state.city.powerDemand = powerDemand;
  state.city.powerRatio = powerRatio;
  state.city.waterSupply = waterSupply;
  state.city.waterDemand = waterDemand;
  state.city.waterRatio = waterRatio;
  for (const key of Object.keys(covered)) {
    state.city.coverage[key] = zoneTotals[key] ? covered[key] / zoneTotals[key] : 0;
  }
  state.city.healthCapacity = healthCap;
  state.city.educationCapacity = eduCap;

  let pollutionTotal = 0;
  let zoned = 0;
  for (let i = 0; i < n; i++) {
    const b = buildings[i];
    const def = b && getDef(b.def);
    if (def && (def.zone === 'residential' || def.zone === 'commercial')) {
      pollutionTotal += pollutionMap[i];
      zoned++;
    }
  }
  state.city.pollution = zoned ? (pollutionTotal / zoned) * mods.pollution : 0;

  return coverageMap;
}

let moodMap = new Float32Array(0);
export const moodBuffer = () => moodMap;

/** Average pollution over a building's footprint. */
export function pollutionAt(state, x, y) {
  ensure(state);
  if (!inBounds(state, x, y)) return 0;
  return pollutionMap[idx(state, x, y)];
}

/** True when a tile is inside the radius of at least one facility. */
export function isCovered(state, x, y, key) {
  ensure(state);
  if (!inBounds(state, x, y)) return false;
  const b = state.grid.buildings[idx(state, x, y)];
  return !!(b && b.svc && b.svc[key]);
}
