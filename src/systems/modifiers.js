/**
 * modifiers.js — timed numeric modifiers.
 *
 * Events, milestones and disasters all express themselves as
 * `{ key, value, ticks }` entries rather than reaching into the economy
 * directly. `snapshot()` folds the live list into a plain object of
 * multipliers that the other systems read; nothing else needs to know an
 * event is running.
 */

const DEFAULTS = Object.freeze({
  taxRate: 1,
  commercialTax: 1,
  industrialTax: 1,
  residentialTax: 1,
  upkeep: 1,
  productivity: 1,
  congestion: 1,
  pollution: 1,
  occupancy: 1,
  powerSupply: 1,
  waterSupply: 1,
  safetyBonus: 1,
  moodFlat: 0,
  demand_residential: 1,
  demand_commercial: 1,
  demand_industrial: 1,
});

export function createSnapshot() {
  return { ...DEFAULTS };
}

export function addModifier(state, key, value, ticks) {
  state.modifiers.push({ key, value, ticks, maxTicks: ticks });
}

/** Flat happiness bonus (additive, not multiplicative). */
export function addMood(state, amount, ticks) {
  addModifier(state, 'moodFlat', amount, ticks);
}

export function decayModifiers(state) {
  const list = state.modifiers;
  for (let i = list.length - 1; i >= 0; i--) {
    if (--list[i].ticks <= 0) list.splice(i, 1);
  }
}

/**
 * Folds modifiers into `out`. Additive keys (moodFlat) sum; everything else
 * multiplies. Called once per tick, before any system reads the snapshot.
 */
export function snapshot(out, state) {
  for (const k in DEFAULTS) out[k] = DEFAULTS[k];
  for (const m of state.modifiers) {
    if (!(m.key in out)) out[m.key] = 1;
    if (m.key === 'moodFlat') out.moodFlat += m.value;
    else out[m.key] *= m.value;
  }
  return out;
}

/** Human-readable list for the inspector's "Active effects" panel. */
export function describe(state) {
  return state.modifiers.map((m) => ({
    key: m.key,
    label: LABELS[m.key] || m.key,
    value: m.value,
    ticks: m.ticks,
    days: Math.ceil(m.ticks / 8),
  }));
}

const LABELS = Object.freeze({
  taxRate: 'Tax rate',
  commercialTax: 'Commercial tax',
  industrialTax: 'Industrial tax',
  residentialTax: 'Residential tax',
  upkeep: 'Upkeep',
  productivity: 'Productivity',
  congestion: 'Congestion',
  pollution: 'Pollution',
  occupancy: 'Occupancy',
  powerSupply: 'Power supply',
  waterSupply: 'Water supply',
  safetyBonus: 'Public safety',
  moodFlat: 'City mood',
  demand_residential: 'Housing demand',
  demand_commercial: 'Shop demand',
  demand_industrial: 'Industry demand',
});
