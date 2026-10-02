#!/usr/bin/env node
/**
 * balance-report.mjs — prints the actual balance curve.
 *
 * Every number quoted in docs/01-GAME-DESIGN.md should come from here rather
 * than from memory, because balance drifts the moment a rate is touched. Run
 * it after any change to src/data/ or src/systems/.
 *
 *   node tools/balance-report.mjs [seed]
 */

import { createState, TERRAIN, } from '../src/core/state.js';
import { createGame } from '../src/core/game.js';
import { createBus } from '../src/core/eventbus.js';
import { ReferencePlayer } from '../test/reference-player.js';

const seed = Number(process.argv[2] || 1337);

const bus = createBus();
bus.on('event:show', () => game.resolveEvent(0));
bus.on('victory', () => console.log(`  *** VICTORY on day ${state.day}`));

const state = createState({ seed });
const game = createGame({ state, bus });
const player = new ReferencePlayer(state, { x0: 2, y0: 1, w: 40, h: 34 });

const rows = [];
const mark = (label) => {
  rows.push({
    tick: state.tick, day: state.day, label,
    pop: state.city.pop,
    happy: state.city.happiness,
    cash: state.economy.cash,
    net: state.economy.net,
    pow: state.city.powerRatio,
    wat: state.city.waterRatio,
    cong: state.city.congestion,
    unemp: state.city.unemployment,
    poll: state.city.pollution,
    demand: { ...state.city.demand },
    coverage: { ...state.city.coverage },
    zones: { ...state.city.zoneCounts },
    loans: state.economy.loans.length,
  });
};

console.log(`\nMicro Metropolis — balance report (seed ${seed})\n`);
console.log('day   pop   happy  cash      net     pow  wat  cong  unemp  demand(R/C/I)      coverage(H/E/S/T)  zones(R/C/I)  loans');
console.log('─'.repeat(132));

for (let i = 0; i < 4000; i++) {
  if (state.deck.active) game.resolveEvent(0);
  player.step();
  game.tick();
  if (state.tick % 250 === 0 || state.won) mark(`day ${state.day}`);
  if (state.won) break;
}

for (const r of rows) {
  const d = r.demand;
  const c = r.coverage;
  console.log(
    `${String(r.day).padStart(3)}  ${String(r.pop).padStart(4)}  ${r.happy.toFixed(0).padStart(4)}  ` +
    `${r.cash.toFixed(0).padStart(8)}  ${r.net.toFixed(0).padStart(6)}  ` +
    `${(r.pow * 100).toFixed(0).padStart(3)}  ${(r.wat * 100).toFixed(0).padStart(3)}  ` +
    `${(r.cong * 100).toFixed(0).padStart(4)}  ${(r.unemp * 100).toFixed(0).padStart(4)}  ` +
    `${(d.residential * 100).toFixed(0).padStart(3)}/${(d.commercial * 100).toFixed(0).padStart(3)}/${(d.industrial * 100).toFixed(0).padStart(3)}        ` +
    `${(c.health * 100).toFixed(0).padStart(3)}/${(c.education * 100).toFixed(0).padStart(3)}/${(c.safety * 100).toFixed(0).padStart(3)}/${(c.transit * 100).toFixed(0).padStart(3)}        ` +
    `${String(r.zones.residential).padStart(3)}/${String(r.zones.commercial).padStart(3)}/${String(r.zones.industrial).padStart(3)}        ${r.loans}`
  );
}

/* ── per-building economics ─────────────────────────────────────────────── */

console.log('\nPer-structure economics at full occupancy, tier 1 (¤/tick)');
console.log('─'.repeat(78));
const RATES = { residential: 0.10, commercial: 0.22, industrial: 0.16, roadPerTile: 0.02 };
const table = [
  ['Housing', 8, RATES.residential, 0.3, 'housing'],
  ['Shops', 6, RATES.commercial, 0.4, 'jobs'],
  ['Industry', 8, RATES.industrial, 0.5, 'jobs'],
  ['Power Plant', 0, 0, 3.0, 'service'],
  ['Water Tower', 0, 0, 1.0, 'service'],
  ['School', 0, 0, 1.5, 'service'],
  ['Hospital', 0, 0, 3.5, 'service'],
  ['Fire Station', 0, 0, 1.4, 'service'],
  ['Police Station', 0, 0, 1.6, 'service'],
];
console.log('structure       income  upkeep   net   note');
for (const [name, units, rate, upkeep, kind] of table) {
  const income = units * rate;
  const net = income - upkeep;
  console.log(
    `${name.padEnd(14)} ${income.toFixed(2).padStart(6)}  ${upkeep.toFixed(2).padStart(6)}  ${net.toFixed(2).padStart(6)}   ` +
    (kind === 'service' ? 'enables growth elsewhere' : 'self-funding when full')
  );
}

/* ── map capacity ───────────────────────────────────────────────────────── */

console.log('\nMap capacity');
console.log('─'.repeat(78));
const counts = {};
for (const t of state.grid.terrain) counts[t] = (counts[t] || 0) + 1;
const total = state.grid.w * state.grid.h;
const buildable = total - (counts[TERRAIN.WATER] || 0);
console.log(`grid            ${state.grid.w} x ${state.grid.h} = ${total} tiles`);
console.log(`water           ${counts[TERRAIN.WATER] || 0} tiles (${((counts[TERRAIN.WATER] || 0) / total * 100).toFixed(0)}%)`);
console.log(`buildable       ${buildable} tiles`);
console.log(`road overhead   ~25% -> ~${Math.round(buildable * 0.75)} zoned tiles`);
console.log(`population cap  ~${Math.round(buildable * 0.75 * 0.62 * 8)} at tier 1, far higher once tiers land`);
console.log(`victory goal    ${state._goalPop || 4000}`);

console.log('\nRun summary');
console.log('─'.repeat(78));
console.log(`won             ${state.won}`);
console.log(`best population ${state.stats.bestPop}`);
console.log(`final day       ${state.day}`);
console.log(`events resolved ${state.stats.eventsResolved}`);
console.log(`structures      ${state.stats.built} built, ${state.stats.demolished} demolished`);
console.log(`emergency loans ${state.economy.loans.length} outstanding, ever taken: ${state.economy.everEmergencyLoan}`);
console.log('');
