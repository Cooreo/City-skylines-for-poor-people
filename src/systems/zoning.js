/**
 * zoning.js — occupancy growth, tier upgrades, abandonment.
 *
 * This is the engine of the core loop. Zoned tiles are *zoned*, not built:
 * the player places an empty lot and the simulation decides how full it gets
 * and how tall it goes. That single idea is what makes the game feel alive
 * rather than like a stamping tool.
 *
 * Growth pressure for one lot
 * ───────────────────────────
 *   pressure = demand(zone)              0..1  city-wide pull from the market
 *            × access                    0/1   needs a road within 1 tile
 *            × utilities                 0..1  power & water rationing
 *            × localMood                 0..1  happiness of this tile's area
 *            × congestionPenalty         0..1
 *            × occupancy modifier        events (floods, evacuations)
 *
 *   occupancy += (pressure − occupancy) × GROWTH_RATE
 *
 * Tier ups happen only at ≥92% occupancy sustained for UPGRADE_PATIENCE ticks,
 * which is why districts visibly densify block by block instead of all at once.
 */

import { getDef, TIERS } from '../data/buildings.js';
import { hasAccess, computeRoadAccess } from './grid.js';
import { moodBuffer, pollutionBuffer } from './services.js';
import { idx } from '../core/state.js';

export const GROWTH_RATE = 0.2;
export const SHRINK_RATE = 0.09;
export const UPGRADE_OCCUPANCY = 0.8;
export const UPGRADE_PATIENCE = 3;      // ticks at full before a tier up
export const ABANDON_OCCUPANCY = 0.08;
export const ABANDON_PATIENCE = 6;      // ticks near-empty before the lot clears

const ZONES = ['residential', 'commercial', 'industrial'];

export function update(state, mods, rng, bus) {
  computeRoadAccess(state);
  const mood = moodBuffer();
  const poll = pollutionBuffer();
  const { w } = state.grid;
  const buildings = state.grid.buildings;

  let housing = 0, jobs = 0, rOcc = 0, cOcc = 0, iOcc = 0, rCap = 0, cCap = 0, iCap = 0;
  let rCount = 0, cCount = 0, iCount = 0;

  /* ── pass 1: grow every zoned lot ────────────────────────────────────── */
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def || ZONES.indexOf(def.zone) === -1) continue;

    const cap = capacityOf(def, b);
    const access = hasAccess(state, i);
    const utilities = (b.powered ? 0.62 : 0) + (b.watered ? 0.38 : 0);

    // Local mood: parks/services push up, pollution and congestion push down.
    const localMood = clamp01(
      0.42
      + mood[i] * 0.05
      + (b.svc && b.svc.health ? 0.08 : 0)
      + (b.svc && b.svc.education ? 0.06 : 0)
      + (b.svc && b.svc.safety ? 0.05 : 0)
      - poll[i] * 0.012
      - state.city.congestion * 0.16
    );

    const demandKey = `demand_${def.zone}`;
    const demand = clamp01(state.city.demand[def.zone] * (mods[demandKey] || 1));
    // Market pull and local quality average together, then scale so a healthy
    // lot saturates and a neglected one empties out.
    const pressure = access
      ? clamp01(((demand + localMood) / 2) * utilities * 1.6 * mods.occupancy)
      : 0;

    const occ = b.occ == null ? 0 : b.occ;
    const delta = pressure - occ;
    const next = occ + delta * (delta > 0 ? GROWTH_RATE : SHRINK_RATE);
    b.occ = clamp01(next);
    b.pressure = pressure;

    /* sustained fullness → tier up */
    if (b.occ >= UPGRADE_OCCUPANCY && b.tier < def.tiers) {
      b.patience = (b.patience || 0) + 1;
      if (b.patience >= UPGRADE_PATIENCE && demand > 0.45 && localMood > 0.4) {
        upgrade(state, b, i, bus);
      }
    } else if (b.occ < UPGRADE_OCCUPANCY) {
      b.patience = 0;
    }

    /* Sustained emptiness → the lot is abandoned and cleared.
       Only lots that once actually had people can be abandoned: an empty lot
       with no power or water is "waiting to be built", not "failing". */
    const everOccupied = b.everOccupied === true || b.occ >= 0.25;
    if (everOccupied && b.everOccupied !== true) b.everOccupied = true;

    if (b.occ <= ABANDON_OCCUPANCY && everOccupied && state.tick - (b.tickBuilt || 0) > 4) {
      b.empty = (b.empty || 0) + 1;
      if (b.empty >= ABANDON_PATIENCE) {
        if (b.tier > 1) {
          b.tier--;
          b.empty = 0;
          b.occ = 0.25;
          if (bus) bus.emit('demolish', { x: i % w, y: (i / w) | 0, defId: b.def, reason: 'downgrade' });
        } else {
          buildings[i] = null;
          if (bus) bus.emit('demolish', { x: i % w, y: (i / w) | 0, defId: b.def, reason: 'abandoned' });
        }
        continue;
      }
    } else {
      b.empty = 0;
    }

    if (def.zone === 'residential') { housing += cap; rOcc += cap * b.occ; rCap += cap; rCount++; }
    else if (def.zone === 'commercial') { jobs += cap; cOcc += cap * b.occ; cCap += cap; cCount++; }
    else { jobs += cap; iOcc += cap * b.occ; iCap += cap; iCount++; }
  }

  state.city.housing = Math.round(housing);
  state.city.jobs = Math.round(jobs);
  state.city.zoneCounts = { residential: rCount, commercial: cCount, industrial: iCount };
  return { rOcc, cOcc, iOcc, rCap, cCap, iCap };
}

/** Residents a residential instance holds at its current tier and occupancy. */
export function capacityOf(def, b) {
  if (def.housing) return def.housing * TIERS.CAPACITY[b.tier - 1];
  if (def.jobs) return def.jobs * TIERS.CAPACITY[b.tier - 1];
  return 0;
}

export function residentsOf(b) {
  const def = getDef(b.def);
  return def && def.housing ? def.housing * TIERS.CAPACITY[b.tier - 1] * (b.occ || 0) : 0;
}

export function jobsOf(b) {
  const def = getDef(b.def);
  return def && def.jobs ? def.jobs * TIERS.CAPACITY[b.tier - 1] * (b.occ || 0) : 0;
}

/** Tier up in place: keeps the lot, raises capacity, flags the renderer for FX. */
export function upgrade(state, b, i, bus) {
  b.tier++;
  b.patience = 0;
  b.occ = 0.62;
  b.variant = (b.variant + 1) % 3;
  b.upgradedAt = state.tick;
  if (bus) {
    bus.emit('build', {
      x: i % state.grid.w, y: (i / state.grid.w) | 0,
      defId: b.def, tier: b.tier, upgrade: true,
    });
  }
}

/**
 * Market demand (a decoupled RCI market).
 *
 * The earlier coupled model degenerated: residential demand fed off jobs, jobs
 * fed off commercial occupancy, commercial occupancy fed off population, and
 * the whole thing collapsed to zero. Here each channel has an *independent*
 * driver so a new city always has somewhere to go:
 *
 *   R — job pull + baseline immigration, gated by happiness.
 *       A town with spare jobs attracts residents; a happy town attracts them
 *       even without jobs (lifestyle migrants), which is what lets turn one
 *       ever become turn ten.
 *   C — shoppers. Demand tracks residents per existing shop workplace.
 *   I — labour supply. Industry expands while there are unemployed hands and
 *       shrinks once the labour pool dries up.
 *
 * All channels clamp to 0..1 and are multiplied by any event modifiers.
 */
export function computeDemand(state, mods) {
  const pop = Math.max(1, state.city.pop);
  const c = state.city.zoneCounts || { residential: 0, commercial: 0, industrial: 0 };
  const workers = pop * 0.62;
  const jobs = state.city.jobs;

  // Happiness opens or closes the gates. The floor is deliberately high: a
  // miserable city should grow *slowly*, not stop dead. A hard zero-growth
  // gate makes a bad early economy unrecoverable, which reads as a bug.
  const gate = clamp01((state.city.happiness - 12) / 52);

  // R: baseline immigration + spare jobs + contentment. The baseline term is
  // what lets a young settlement with no jobs yet still attract its first
  // residents.
  const jobPull = clamp01(0.5 + (jobs - workers * 0.6) / Math.max(28, jobs * 0.6));
  const rRaw = clamp01(0.26 + 0.44 * gate + 0.30 * jobPull);

  // C: one shop workplace comfortably serves ~9 residents.
  const shopCapacity = c.commercial * 6 * 9 + 12;   // +12 = market stalls
  const cRaw = clamp01((pop / shopCapacity) * 0.9 + 0.12 * gate);

  // I: expands while labour is available and there is room to export.
  const labour = clamp01(state.city.unemployment * 2.4 + (workers > jobs ? 0.5 : 0.12));
  const iRaw = clamp01(labour * 0.8 + 0.2 * gate);

  // Clamp AFTER the modifier: an event that boosts housing demand must not
  // push the stored value past 1.0, or the HUD would read "160% demand" and
  // the next tick's market maths would compound from an out-of-range base.
  state.city.demand.residential = clamp01(rRaw * (mods.demand_residential || 1));
  state.city.demand.commercial = clamp01(cRaw * (mods.demand_commercial || 1));
  state.city.demand.industrial = clamp01(iRaw * (mods.demand_industrial || 1));
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Convenience for the inspector: a 0..1 "how healthy is this lot" score. */
export function lotHealth(state, x, y) {
  const b = state.grid.buildings[idx(state, x, y)];
  if (!b) return 0;
  const factors = [
    hasAccess(state, idx(state, x, y)) ? 1 : 0,
    b.powered ? 1 : 0.25,
    b.watered ? 1 : 0.25,
    clamp01((b.occ || 0) * 1.2),
  ];
  return factors.reduce((a, v) => a + v, 0) / factors.length;
}
