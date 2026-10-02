/**
 * population.js — headcount, employment and congestion.
 *
 * Population is *derived*, never incremented directly:
 *
 *     pop = Σ residential.housing × tierCapacity × occupancy
 *
 * Occupancy is the only state variable (see zoning.js), so a blackout, a
 * flood or a bad mood automatically moves the population number without any
 * special-casing. That is the whole trick to a city builder that feels
 * coherent instead of scripted.
 */

import { getDef } from '../data/buildings.js';
import { residentsOf, jobsOf } from './zoning.js';
import { collectRoadTiles } from './grid.js';

const roadTilesScratch = [];

export function update(state, mods) {
  const buildings = state.grid.buildings;
  let pop = 0, commercialJobs = 0, industrialJobs = 0;
  let rOccupied = 0, rLots = 0;

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def) continue;
    if (def.zone === 'residential') {
      pop += residentsOf(b);
      rOccupied += b.occ || 0;
      rLots++;
    } else if (def.zone === 'commercial') {
      commercialJobs += jobsOf(b);
    } else if (def.zone === 'industrial') {
      industrialJobs += jobsOf(b);
    }
  }

  const totalJobs = (commercialJobs + industrialJobs) * mods.productivity;
  const workingAge = pop * 0.62;
  const employed = Math.min(workingAge, totalJobs);
  // Raw jobless rate, 0..1.
  const joblessRate = workingAge > 0 ? 1 - employed / workingAge : 0;
  // A hamlet of eight is not a labour market. Scale the rate by how much of a
  // workforce actually exists so a young settlement is not judged by the same
  // standard as a city -- otherwise the very first housing lot drives
  // happiness to zero and the player cannot get started.
  const workforceWeight = Math.min(1, workingAge / 40);
  const unemployment = joblessRate * workforceWeight;

  state.city.pop = Math.round(pop);
  state.city.employed = Math.round(employed);
  state.city.commercialJobs = Math.round(commercialJobs);
  state.city.industrialJobs = Math.round(industrialJobs);
  state.city.unemployment = unemployment;
  state.city.occupancyAvg = rLots ? rOccupied / rLots : 0;

  /* ── congestion ──────────────────────────────────────────────────────── */
  const roads = collectRoadTiles(state, roadTilesScratch);
  let capacity = 0;
  for (const i of roads) {
    const b = state.grid.buildings[i];
    capacity += b && b.def === 'boulevard' ? 3 : 1;
  }
  // Transit coverage relieves the roads it touches.
  const relief = 1 - state.city.coverage.transit * 0.45;
  // Each road tile comfortably serves ~9 residents' worth of trips. The bot
  // above over-builds roads (3 road tiles per zone tile), so a well-laid-out
  // city sits well below the cap while a grid-locked one hits it.
  const load = (pop * 0.22 + totalJobs * 0.34) * mods.congestion * relief;
  const raw = capacity > 0 ? load / (capacity * 9) : (pop > 4 ? 1 : 0);
  state.city.congestion = clamp01(raw);
  state.city.roadTiles = roads.length;
  state.city.roadCapacity = capacity;

  state.stats.bestPop = Math.max(state.stats.bestPop, state.city.pop);
  return state.city;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** Short label for the top bar's population subtext. */
export function popDescriptor(pop) {
  if (pop < 60) return 'a handful of settlers';
  if (pop < 250) return 'a growing hamlet';
  if (pop < 700) return 'a busy village';
  if (pop < 1600) return 'a proper town';
  if (pop < 3200) return 'a sprawling city';
  return 'a true metropolis';
}
