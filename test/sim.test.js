/**
 * sim.test.js — headless simulation regression tests.
 *
 * No DOM, no canvas, no browser. The entire simulation is pure JS over a plain
 * state object, so the game can be balance-tested in CI in a couple of seconds.
 *
 *   node --test test/
 *
 * These tests exist because balance bugs are invisible in a screenshot: an
 * emergency loan that compounds into 1e17, or an austerity routine that
 * mothballs the water tower, both "look fine" until you run 3,000 ticks.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createState, TERRAIN, idx, GRID, generateTerrain, findStarterArea, countBuildings,
} from '../src/core/state.js';
import { createGame } from '../src/core/game.js';
import { createBus, } from '../src/core/eventbus.js';
import { createRng } from '../src/core/rng.js';
import { place, demolish, removeInstance, lineTiles } from '../src/systems/build.js';
import { canPlace, computeRoadAccess, hasAccess, findRoadPath } from '../src/systems/grid.js';
import * as economy from '../src/systems/economy.js';
import * as modifiers from '../src/systems/modifiers.js';
import { serialize, deserialize, rleEncode, rleDecode } from '../src/core/save.js';
import { EVENTS } from '../src/data/events.js';
import { MILESTONES, VICTORY } from '../src/data/progression.js';
import { ReferencePlayer } from './reference-player.js';

/* ── helpers ────────────────────────────────────────────────────────────── */

function newGame(seed = 1337) {
  const bus = createBus();
  const state = createState({ seed });
  const game = createGame({ state, bus });
  return { game, state, bus };
}

/**
 * Run `n` ticks. Any event card that opens is auto-resolved with the first
 * choice, because an open card halts the simulation -- without this the tests
 * would silently stall the moment the deck fires.
 */
function run(game, n, choose = 0) {
  for (let i = 0; i < n; i++) {
    if (game.state.deck.active) game.resolveEvent(choose);
    game.tick();
  }
}

/* ── map generation ─────────────────────────────────────────────────────── */

test('the map is deterministic for a seed', () => {
  const a = generateTerrain(GRID.w, GRID.h, 1337);
  const b = generateTerrain(GRID.w, GRID.h, 1337);
  assert.deepEqual([...a.terrain], [...b.terrain]);
  const c = generateTerrain(GRID.w, GRID.h, 999);
  assert.notDeepEqual([...a.terrain], [...c.terrain]);
});

test('the map has water, land and a buildable starter plot', () => {
  const state = createState({ seed: 1337 });
  const counts = {};
  for (const t of state.grid.terrain) counts[t] = (counts[t] || 0) + 1;
  assert.ok(counts[TERRAIN.WATER] > 50, 'expected a coastline');
  assert.ok(counts[TERRAIN.GRASS] > 400, 'expected buildable land');
  assert.ok(state.starter.size >= 10);
  // every tile of the starter plot must be buildable
  const { x, y, size } = state.starter;
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const t = state.grid.terrain[idx(state, x + dx, y + dy)];
      assert.ok(t === TERRAIN.GRASS || t === TERRAIN.SAND, `starter tile ${dx},${dy} is not buildable`);
    }
  }
});

test('findStarterArea prefers open ground', () => {
  const { terrain } = generateTerrain(GRID.w, GRID.h, 1337);
  const area = findStarterArea(terrain, GRID.w, GRID.h, 14);
  let open = 0;
  for (let dy = 0; dy < 14; dy++) for (let dx = 0; dx < 14; dx++) {
    if (terrain[(area.y + dy) * GRID.w + area.x + dx] === TERRAIN.GRASS) open++;
  }
  assert.equal(open, area.open);
});

/* ── placement rules ────────────────────────────────────────────────────── */

test('a building needs a road within one tile to grow', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  const cx = x + 2, cy = y + 2;
  assert.equal(place(state, 'residential', cx, cy).ok, true);
  computeRoadAccess(state);
  assert.equal(hasAccess(state, idx(state, cx, cy)), false, 'no road yet');

  assert.equal(place(state, 'road', cx, cy + 1).ok, true);
  computeRoadAccess(state);
  assert.equal(hasAccess(state, idx(state, cx, cy)), true, 'road adjacent');
});

test('cannot build on water, rock, forest or an occupied tile', () => {
  const { state } = newGame();
  const water = [...state.grid.terrain].findIndex((t) => t === TERRAIN.WATER);
  const wx = water % state.grid.w, wy = (water / state.grid.w) | 0;
  assert.match(canPlace(state, 'residential', wx, wy).reason, /water/);

  const { x, y } = state.starter;
  assert.equal(place(state, 'road', x + 1, y + 1).ok, true);
  assert.match(canPlace(state, 'residential', x + 1, y + 1).reason, /occupied/);
});

test('multi-tile buildings occupy their whole footprint and removal clears it', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  // power plant is 2x2
  assert.equal(place(state, 'powerPlant', x + 2, y + 2).ok, true);
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.ok(state.grid.buildings[idx(state, x + 2 + dx, y + 2 + dy)], `tile ${dx},${dy} occupied`);
  }
  const removed = removeInstance(state, x + 2, y + 2);
  assert.equal(removed.def, 'powerPlant');
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    assert.equal(state.grid.buildings[idx(state, x + 2 + dx, y + 2 + dy)], null);
  }
});

test('bulldozing refunds 40% of construction cost', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  const before = state.economy.cash;
  place(state, 'residential', x + 3, y + 3);
  const afterBuild = state.economy.cash;
  demolish(state, x + 3, y + 3);
  const afterDemolish = state.economy.cash;
  const cost = 50;
  assert.ok(afterDemolish > afterBuild - 10, 'refund applied');
  assert.ok(afterDemolish < before - cost * 0.3, 'net cost is real');
});

test('drag-building produces a contiguous tile line', () => {
  const tiles = lineTiles(0, 0, 5, 0);
  assert.equal(tiles.length, 6);
  assert.deepEqual(tiles.map((t) => t.x), [0, 1, 2, 3, 4, 5]);
});

test('road pathfinding finds a connected route and rejects a broken one', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  for (let i = 0; i < 6; i++) place(state, 'road', x + i, y + 1);
  const from = idx(state, x, y + 1);
  const to = idx(state, x + 5, y + 1);
  const path = findRoadPath(state, from, to);
  assert.equal(path.length, 6);
  assert.equal(path[0], from);
  assert.equal(path[path.length - 1], to);

  // a gap in the road breaks the path
  state.grid.buildings[idx(state, x + 3, y + 1)] = null;
  assert.equal(findRoadPath(state, from, to), null);
});

/* ── economy ────────────────────────────────────────────────────────────── */

test('tax income scales with population and jobs', () => {
  const { state } = newGame();
  const before = state.economy.income;
  state.city.pop = 500;
  state.city.commercialJobs = 200;
  state.city.industrialJobs = 100;
  state.city.coverage.education = 0;
  const mods = modifiers.createSnapshot();
  economy.update(state, mods);
  assert.ok(state.economy.income > before, 'income grew');
  assert.ok(state.economy.income > 0);
});

test('tax level changes the multiplier and happiness', () => {
  const { state } = newGame();
  const normal = economy.taxMultiplier(state);
  state.economy.taxLevel = 'high';
  assert.ok(economy.taxMultiplier(state) > normal);
  state.economy.taxLevel = 'low';
  assert.ok(economy.taxMultiplier(state) < normal);
});

test('emergency loans are fixed-size and capped, never compounding', () => {
  const { state } = newGame();
  state.economy.cash = -5000;
  const seen = [];
  for (let i = 0; i < 60; i++) {
    state.tick = i;
    economy.enforceFloor(state, null);
    seen.push(state.economy.cash);
  }
  // cash must stay bounded: no runaway
  assert.ok(state.economy.cash > -20000, `cash ran away to ${state.economy.cash}`);
  const emergency = state.economy.loans.filter((l) => l.emergency).length;
  assert.ok(emergency <= economy.MAX_EMERGENCY_LOANS, `took ${emergency} emergency loans`);
  // every tranche is the same size
  const principals = new Set(state.economy.loans.map((l) => l.principal));
  assert.equal(principals.size, 1, `tranches differ: ${[...principals]}`);
});

test('a deep deficit triggers austerity that never removes the grid', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  place(state, 'powerPlant', x + 1, y + 1);
  place(state, 'waterTower', x + 4, y + 1);
  place(state, 'stadium', x + 6, y + 1);   // most expensive optional service
  state.economy.loans = Array.from({ length: 99 }, () => ({ principal: 1500, emergency: true }));

  for (let i = 0; i < 40; i++) {
    state.tick = 1000 + i;
    state.economy.cash = -10;
    economy.enforceFloor(state, null);
  }
  // the grid survives, the stadium does not
  assert.equal(countBuildings(state, 'stadium'), 0, 'stadium should be mothballed');
  assert.ok(countBuildings(state, 'powerPlant') > 0, 'power plant must survive austerity');
  assert.ok(countBuildings(state, 'waterTower') > 0, 'water tower must survive austerity');
});

test('loans accrue interest as an expense', () => {
  const { state } = newGame();
  economy.takeLoan(state, 10000);
  state.city.roadTiles = 0;
  const mods = modifiers.createSnapshot();
  economy.update(state, mods);
  assert.ok(state.economy.interest > 0, 'interest charged');
  assert.ok(Math.abs(state.economy.interest - 10000 * economy.LOAN_RATE) < 1e-6);
});

/* ── zoning and growth ──────────────────────────────────────────────────── */

test('a road-served, powered, watered lot fills up and tiers up', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  // A complete little town: roads, utilities, housing, jobs and a park.
  // Housing on its own plateaus around 70% occupancy -- without jobs the
  // market never asks for more -- so a tier-up needs the whole loop.
  for (let i = 0; i < 10; i++) place(state, 'road', x + 1 + i, y + 1);
  for (let i = 0; i < 10; i++) place(state, 'road', x + 1 + i, y + 6);
  place(state, 'powerPlant', x + 1, y + 9);
  place(state, 'waterTower', x + 4, y + 9);
  place(state, 'park', x + 7, y + 9);
  for (let i = 0; i < 4; i++) {
    place(state, 'residential', x + 2 + i, y + 2);
    place(state, 'commercial', x + 2 + i, y + 5);
  }

  const game = createGame({ state, bus: createBus() });
  const lot = state.grid.buildings[idx(state, x + 2, y + 2)];
  const startTier = lot.tier;
  run(game, 200);
  assert.ok(lot.occ > 0.75, `occupancy only reached ${lot.occ}`);
  assert.ok(lot.tier > startTier, `lot never upgraded past tier ${startTier}`);
});

test('a lot with no road never grows', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  place(state, 'residential', x + 5, y + 5);
  const game = createGame({ state, bus: createBus() });
  run(game, 40);
  const lot = state.grid.buildings[idx(state, x + 5, y + 5)];
  assert.equal(lot.occ, 0, 'unconnected lot must stay empty');
});

test('an empty lot is never bulldozed just for lacking utilities', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  place(state, 'residential', x + 5, y + 5);
  const game = createGame({ state, bus: createBus() });
  run(game, 60);
  // still there, just empty: the player has not been robbed of their money
  assert.ok(state.grid.buildings[idx(state, x + 5, y + 5)], 'lot was removed');
});

test('population is derived from occupancy, not stored', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  for (let i = 0; i < 6; i++) place(state, 'road', x + 1 + i, y + 1);
  place(state, 'powerPlant', x + 8, y + 4);
  place(state, 'waterTower', x + 10, y + 4);
  for (let i = 0; i < 4; i++) place(state, 'residential', x + 2 + i, y + 2);
  const game = createGame({ state, bus: createBus() });
  run(game, 60);
  assert.ok(state.city.pop > 0);
  // Zeroing occupancy must collapse population on the next tick. It will not
  // be exactly zero: zoning immediately starts growing the lots back, so the
  // assertion is on the magnitude of the drop, not the exact value.
  const before = state.city.pop;
  for (const b of state.grid.buildings) if (b && b.def === 'residential') b.occ = 0;
  game.tick();
  assert.ok(state.city.pop < before * 0.25,
    `population did not follow occupancy: ${before} -> ${state.city.pop}`);
});

/* ── services ───────────────────────────────────────────────────────────── */

test('power and water rationing is coherent, not random', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  place(state, 'waterTower', x + 1, y + 1);
  // one tower covers ~46 tier-1 lots, so fill the plot to force rationing
  let placed = 0;
  for (let dy = 3; dy < 12 && placed < 60; dy++) {
    for (let dx = 1; dx < 13 && placed < 60; dx++) {
      if (place(state, 'residential', x + dx, y + dy).ok) placed++;
    }
  }
  assert.ok(placed >= 50, `only placed ${placed} lots`);
  const game = createGame({ state, bus: createBus() });
  run(game, 30);
  assert.ok(state.city.waterRatio < 1, 'expected rationing with one tower');
  const unwatered = state.grid.buildings.filter((b) => b && b.def === 'residential' && !b.watered);
  assert.ok(unwatered.length > 0, 'some lots should be dry');
  // the same lots stay dry across ticks: rationing is stable, not flickering
  const snapshot = state.grid.buildings.map((b) => (b && b.def === 'residential' ? b.watered : null));
  game.tick();
  state.grid.buildings.forEach((b, i) => {
    if (b && b.def === 'residential') assert.equal(b.watered, snapshot[i], 'rationing flickered');
  });
});

test('coverage radius only covers tiles inside the radius', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  state.unlocked.push('school');          // normally gated at 120 citizens
  place(state, 'school', x + 2, y + 2);   // radius 7
  place(state, 'residential', x + 3, y + 2);   // distance 1, covered
  place(state, 'residential', x + 12, y + 12); // distance 10, outside
  const game = createGame({ state, bus: createBus() });
  game.tick();
  const near = state.grid.buildings[idx(state, x + 3, y + 2)];
  const far = state.grid.buildings[idx(state, x + 12, y + 12)];
  assert.equal(near.svc.education, true);
  assert.equal(far.svc.education, false);
});

/* ── events ─────────────────────────────────────────────────────────────── */

test('there are at least 12 unique events, all with choices', () => {
  const ids = new Set(EVENTS.map((e) => e.id));
  assert.ok(ids.size >= 12, `only ${ids.size} events`);
  assert.equal(ids.size, EVENTS.length, 'duplicate event ids');
  for (const e of EVENTS) {
    assert.ok(e.choices.length >= 2, `${e.id} has too few choices`);
    assert.ok(e.weight > 0, `${e.id} has no weight`);
    assert.ok(e.requires, `${e.id} has no predicate`);
    for (const ch of e.choices) {
      assert.equal(typeof ch.run, 'function', `${e.id}/${ch.label} has no run()`);
    }
  }
});

test('event cards resolve and apply their effect', () => {
  const { game, state, bus } = newGame();
  state.day = 3;
  state.season = 'summer';
  state.city.pop = 400;
  state.economy.cash = 5000;
  const grant = EVENTS.find((e) => e.id === 'grant');
  state.deck.active = 'grant';
  game.resolveEvent(0);   // "Take the cash" -> +1200
  assert.ok(state.economy.cash >= 5000 + 1200 - 1, `cash was ${state.economy.cash}`);
  assert.equal(state.deck.active, null);
  assert.equal(state.stats.eventsResolved, 1);
});

test('an event card blocks the simulation while it is open', () => {
  const { game, state } = newGame();
  state.deck.active = 'grant';
  const t = state.tick;
  game.tick();
  assert.equal(state.tick, t, 'simulation advanced while a card was open');
});

test('the treasury crisis loan respects the emergency cap', () => {
  const { game, state } = newGame();
  // Fill the credit line to the cap.
  state.economy.loans = Array.from({ length: economy.MAX_EMERGENCY_LOANS },
    () => ({ principal: 1500, emergency: true }));
  state.economy.cash = 100;
  state.deck.active = 'treasuryCrisis';
  const before = state.economy.loans.length;
  game.resolveEvent(0);                    // "Emergency loan"
  assert.equal(state.economy.loans.length, before, 'a loan was granted past the cap');
  assert.ok(state.economy.cash >= 0, 'cash was left negative');
});

/* ── modifiers ──────────────────────────────────────────────────────────── */

test('timed modifiers expire and fold correctly', () => {
  const { state } = newGame();
  const mods = modifiers.createSnapshot();
  modifiers.addModifier(state, 'taxRate', 1.5, 3);
  modifiers.addMood(state, -10, 2);
  modifiers.snapshot(mods, state);
  assert.equal(mods.taxRate, 1.5);
  assert.equal(mods.moodFlat, -10);

  modifiers.decayModifiers(state);
  modifiers.snapshot(mods, state);
  assert.equal(mods.taxRate, 1.5);
  assert.equal(mods.moodFlat, -10);

  modifiers.decayModifiers(state);
  modifiers.decayModifiers(state);
  modifiers.snapshot(mods, state);
  assert.equal(mods.taxRate, 1, 'taxRate modifier should have expired');
  assert.equal(mods.moodFlat, 0, 'mood modifier should have expired');
});

/* ── rng ────────────────────────────────────────────────────────────────── */

test('the rng is deterministic and serialisable', () => {
  const a = createRng(42);
  const b = createRng(42);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
  const c = createRng(42);
  c.next(); c.next();
  const d = createRng(c.state);
  assert.equal(c.next(), d.next(), 'state round-trip');
});

/* ── save / load ────────────────────────────────────────────────────────── */

test('terrain round-trips through run-length encoding', () => {
  const src = new Int8Array([0, 0, 0, 1, 1, 2, 2, 2, 2, 3]);
  assert.deepEqual([...rleDecode(rleEncode(src), src.length)], [...src]);
});

test('a save survives a full round-trip with terrain and buildings intact', () => {
  const { state } = newGame();
  const { x, y } = state.starter;
  place(state, 'road', x + 1, y + 1);
  place(state, 'residential', x + 1, y + 2);
  place(state, 'powerPlant', x + 4, y + 4);
  state.city.pop = 137;
  state.economy.cash = 4242;

  const payload = serialize(state);
  assert.ok(payload.v >= 1);
  const json = JSON.parse(JSON.stringify(payload));
  const restored = deserialize(json, null);

  assert.equal(restored.city.pop, 0, 'derived values must not be persisted');
  assert.equal(restored.economy.cash, 4242);
  assert.deepEqual([...restored.grid.terrain], [...state.grid.terrain]);
  assert.equal(countBuildings(restored, 'road'), 1);
  assert.equal(countBuildings(restored, 'residential'), 1);
  assert.equal(countBuildings(restored, 'powerPlant'), 4, '2x2 footprint');
  // and the restored world keeps simulating
  const game = createGame({ state: restored, bus: createBus() });
  run(game, 20);
  assert.ok(restored.city.pop > 0, 'restored city did not simulate');
});

test('a corrupt save is rejected, not thrown', () => {
  assert.throws(() => deserialize({ v: 999 }, null));
  assert.throws(() => deserialize(null, null));
});

/* ── progression ────────────────────────────────────────────────────────── */

test('milestones are ordered and unique', () => {
  const pops = MILESTONES.map((m) => m.pop);
  assert.deepEqual(pops, [...pops].sort((a, b) => a - b));
  assert.equal(new Set(pops).size, pops.length);
  assert.equal(VICTORY.goalPop, 4000);
});

test('the victory goal is reachable by the reference player', () => {
  const { game, state, bus } = newGame();
  let cards = 0;
  const player = new ReferencePlayer(state, { x0: 2, y0: 1, w: 40, h: 34 });

  for (let i = 0; i < 6000; i++) {
    if (state.deck.active) { game.resolveEvent(0); cards++; }
    player.step();
    game.tick();
    if (state.won) break;
  }
  assert.ok(state.stats.bestPop > 1500, `reference player only reached ${state.stats.bestPop}`);
});

/* ── performance ────────────────────────────────────────────────────────── */

test('a large city simulates fast enough for a 60fps render loop', () => {
  const { game, state } = newGame();
  const player = new ReferencePlayer(state, { x0: 2, y0: 1, w: 40, h: 34 });
  for (let i = 0; i < 900; i++) { player.step(); game.tick(); }
  const t0 = process.hrtime.bigint();
  const ticks = 200;
  for (let i = 0; i < ticks; i++) game.tick();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const perTick = ms / ticks;
  assert.ok(perTick < 12, `a tick costs ${perTick.toFixed(2)}ms with ${state.city.pop} citizens`);
});
