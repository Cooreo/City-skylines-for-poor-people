/**
 * happiness.js — per-zone mood and the city-wide aggregate.
 *
 * Happiness is computed per zone rather than per tile because the UI shows
 * three numbers and a per-tile average would be noise. Each zone gets its own
 * weighting: residents care about parks, pollution and taxes; shops care about
 * footfall and congestion; industry cares about workers and safety.
 *
 * The city number is a weighted blend — 60% residents, 25% commercial,
 * 15% industrial — smoothed with an EMA so the meter glides instead of
 * twitching every tick.
 */

import { getDef } from '../data/buildings.js';
import { moodBuffer, pollutionBuffer } from './services.js';
import { TAX_LEVELS } from '../data/progression.js';

export const EMA = 0.28;

const WEIGHTS = { residential: 0.6, commercial: 0.25, industrial: 0.15 };

export function update(state, mods) {
  const mood = moodBuffer();
  const poll = pollutionBuffer();
  const buildings = state.grid.buildings;
  const cov = state.city.coverage;

  const acc = { residential: { s: 0, n: 0 }, commercial: { s: 0, n: 0 }, industrial: { s: 0, n: 0 } };

  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def || !acc[def.zone]) continue;
    if (!b.occ || b.occ <= 0.02) continue;

    const local = score(def.zone, {
      mood: mood[i],
      pollution: poll[i],
      svc: b.svc || {},
      powered: b.powered,
      watered: b.watered,
      congestion: state.city.congestion,
      unemployment: state.city.unemployment,
      deficit: state.economy.deficitStreak,
      taxLevel: state.economy.taxLevel,
    });

    const weight = def.zone === 'residential' ? b.occ : b.occ;
    acc[def.zone].s += local * weight;
    acc[def.zone].n += weight;
  }

  const zoneHappiness = state.city.zoneHappiness;
  let weighted = 0, weightTotal = 0;
  for (const zone of Object.keys(acc)) {
    const raw = acc[zone].n > 0 ? acc[zone].s / acc[zone].n : 50;
    zoneHappiness[zone] = lerp(zoneHappiness[zone], clamp(raw, 0, 100), EMA);
    const w = WEIGHTS[zone];
    weighted += zoneHappiness[zone] * w;
    weightTotal += w;
  }

  let city = weighted / weightTotal;
  city += mods.moodFlat;
  city += taxMood(state.economy.taxLevel);

  // A deficit is felt everywhere and escalates the longer it lasts.
  if (state.economy.deficitStreak > 2) city -= Math.min(12, 2 + (state.economy.deficitStreak-2) * 1.5);

  state.city.happiness = clamp(lerp(state.city.happiness, city, EMA), 0, 100);
  state.stats.bestHappiness = Math.max(state.stats.bestHappiness, state.city.happiness);

  // Expose the breakdown for the inspector's "Why is this number what it is".
  state.city.happinessFactors = breakdown(state, mods);
  return state.city.happiness;
}

/** Score one zoned tile for its zone, 0..100 before smoothing. */
function score(zone, f) {
  let s = 52;
  s += Math.min(14, f.mood * 1.15);                 // parks, plazas, civic
  s += f.svc.health ? 7 : -4;
  s += f.svc.education ? 6 : -2;
  s += f.svc.safety ? 6 : -3;
  s += f.svc.transit ? 3 : 0;
  s -= Math.min(16, f.pollution * 0.55);
  s -= f.congestion * 10;
  if (!f.powered) s -= 18;
  if (!f.watered) s -= 14;

  if (zone === 'residential') {
    // Unemployment is a signal to build jobs, not a cliff: it only bites once
    // more than 15% of workers are idle.
    s -= Math.max(0, f.unemployment - 0.15) * 26;
    // Capped: the city-level aggregate applies the escalating deficit penalty.
    s -= Math.min(8, f.deficit * 0.8);
  } else if (zone === 'commercial') {
    s -= f.congestion * 8;      // shops hate gridlock twice over
    s += f.svc.transit ? 4 : 0; // …but love a metro at the door
  } else {
    s += f.unemployment * 8;    // labour supply is a benefit to industry
    s -= f.congestion * 4;
  }
  return clamp(s, 0, 100);
}

function taxMood(level) {
  const row = TAX_LEVELS.find((t) => t.id === level) || TAX_LEVELS[1];
  return row.mood;
}

/** Human-readable contribution list, sorted by magnitude. */
export function breakdown(state, mods) {
  const cov = state.city.coverage;
  const rows = [
    { label: 'Parks & plazas', value: Math.min(14, avgMood(state) * 1.15), good: true },
    { label: 'Health cover', value: cov.health > 0.5 ? 7 : -4, good: cov.health > 0.5 },
    { label: 'Schools', value: cov.education > 0.5 ? 6 : -2, good: cov.education > 0.5 },
    { label: 'Safety', value: cov.safety > 0.5 ? 6 : -3, good: cov.safety > 0.5 },
    { label: 'Air quality', value: -Math.min(16, state.city.pollution * 0.55), good: false },
    { label: 'Traffic', value: -state.city.congestion * 13, good: false },
    { label: 'Unemployment', value: -state.city.unemployment * 14, good: false },
    { label: 'Tax level', value: taxMood(state.economy.taxLevel), good: state.economy.taxLevel === 'low' },
    { label: 'Events & mood', value: mods.moodFlat, good: mods.moodFlat >= 0 },
  ];
  if (state.economy.deficitStreak > 0) {
    rows.push({ label: 'Budget deficit', value: -Math.min(18, 3 + state.economy.deficitStreak * 2.2), good: false });
  }
  return rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

function avgMood(state) {
  const mood = moodBuffer();
  const b = state.grid.buildings;
  let sum = 0, n = 0;
  for (let i = 0; i < b.length; i++) {
    const bl = b[i];
    if (!bl) continue;
    const def = getDef(bl.def);
    if (!def || def.zone !== 'residential') continue;
    sum += mood[i]; n++;
  }
  return n ? sum / n : 0;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
