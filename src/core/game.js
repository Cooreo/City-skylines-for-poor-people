/**
 * game.js — the simulation orchestrator.
 *
 * Two clocks, deliberately:
 *
 *   visual clock   advanced every animation frame, so the sun glides and
 *                  citizens walk smoothly at 60 fps.
 *   sim tick       a fixed 2.5 s heartbeat (scaled by the speed control) that
 *                  runs the systems in a strict order.
 *
 * Tick order matters and is the one thing not to reorder casually:
 *
 *   1 modifiers   fold timed effects into a snapshot the rest can read
 *   2 services    power/water rationing + coverage + pollution maps
 *   3 zoning      occupancy moves toward pressure (reads last tick's demand)
 *   4 population  derive pop, jobs, congestion
 *   5 demand      recompute market demand from the new numbers
 *   6 happiness   per-zone mood → city aggregate
 *   7 economy     tax the result, pay the upkeep
 *   8 events      maybe open a card
 *   9 progression unlocks, milestones, victory
 *
 * The whole file is DOM-free: `test/sim.test.js` imports it and runs thousands
 * of ticks in Node with no browser involved.
 */

import { createState, SAVE_VERSION } from './state.js';
import { createRng } from './rng.js';
import { createBus, EV } from './eventbus.js';
import * as modifiers from '../systems/modifiers.js';
import * as services from '../systems/services.js';
import * as zoning from '../systems/zoning.js';
import * as population from '../systems/population.js';
import * as happiness from '../systems/happiness.js';
import * as economy from '../systems/economy.js';
import * as eventsys from '../systems/eventsys.js';
import * as progression from '../systems/progression.js';
import * as daynight from '../systems/daynight.js';
import { TAX_LEVELS } from '../data/progression.js';

export const TIME = Object.freeze({
  /** Wall-clock seconds per simulation tick at speed 1. */
  TICK_SECONDS: 2.5,
  /** Sim ticks that make up one in-game day. */
  TICKS_PER_DAY: daynight.TICKS_PER_DAY,
  /** Speed multipliers, indexed by state.speed. */
  SPEED: [0, 1, 2.4, 4.5],
  /** Never simulate more than this many ticks in one frame (tab was hidden). */
  MAX_CATCHUP: 4,
});

export function createGame({ state = null, bus = createBus(), seed = 1337 } = {}) {
  const world = state || createState({ seed });
  const rng = createRng(world.rngState || seed);
  const mods = modifiers.createSnapshot();
  const clock = { clock: world.clock, day: world.day, season: world.season, phase: 'day' };

  let accumulator = 0;
  let lastTickAt = 0;

  /** Attach the bus so systems can emit without it being passed everywhere. */
  world.bus = bus;
  world.rng = rng;

  /** Run exactly one simulation tick. Pure-ish: mutates `world`, emits events. */
  function tick() {
    if (eventsys.isBlocked(world)) return;         // a card is open

    modifiers.decayModifiers(world);
    modifiers.snapshot(mods, world);

    services.update(world, mods);
    zoning.update(world, mods, rng, bus);
    population.update(world, mods);
    zoning.computeDemand(world, mods);
    happiness.update(world, mods);

    const warning = economy.update(world, mods);
    economy.recordHistory(world);
    economy.enforceFloor(world, bus);
    if (warning) {
      bus.emit(EV.TOAST, warning.warning === 'deficit'
        ? { text: 'The treasury is in the red. Happiness will fall.', tone: 'danger', ttl: 6000 }
        : { text: `Deficit for ${warning.streak} ticks — the city is losing faith.`, tone: 'danger', ttl: 6000 });
    }

    world.tick++;
    if (world.tick % TIME.TICKS_PER_DAY === 0) {
      world.day++;
      const s = Math.floor(((world.day - 1) / daynight.DAYS_PER_SEASON) % 4);
      world.season = daynight.SEASONS[s];
    }

    eventsys.update(world, rng, bus);
    progression.update(world, bus);

    world.rngState = rng.state;
    bus.emit(EV.TICK, { tick: world.tick, day: world.day, season: world.season });
  }

  /**
   * Called from the animation frame. `dt` is real seconds since last frame.
   * Returns the number of sim ticks that ran (0 most frames).
   */
  function update(dt) {
    daynight.advance(clock, dt, world.speed);
    world.clock = clock.clock;
    world.day = clock.day;
    world.season = clock.season;

    if (world.speed === 0) return 0;
    const interval = TIME.TICK_SECONDS / TIME.SPEED[world.speed];
    accumulator += dt;
    let ran = 0;
    while (accumulator >= interval && ran < TIME.MAX_CATCHUP) {
      accumulator -= interval;
      tick();
      ran++;
    }
    if (ran >= TIME.MAX_CATCHUP) accumulator = 0;   // drop the backlog
    return ran;
  }

  const api = {
    state: world,
    bus,
    rng,
    clock,
    mods,
    tick,
    update,
    /** Force n ticks — used by the headless test harness and the debug menu. */
    fastForward(n) { for (let i = 0; i < n; i++) tick(); },
    setSpeed(s) {
      world.speed = Math.max(0, Math.min(3, s | 0));
      accumulator = 0;
      bus.emit(EV.SPEED, { speed: world.speed });
    },
    cycleSpeed() { api.setSpeed((world.speed + 1) % 4); },
    setTaxLevel(id) {
      if (TAX_LEVELS.some((t) => t.id === id)) {
        world.economy.taxLevel = id;
        bus.emit(EV.STATE, world);
      }
    },
    resolveEvent(choiceIndex) { return eventsys.resolve(world, choiceIndex, bus); },
    get lastTickAt() { return lastTickAt; },
    set lastTickAt(v) { lastTickAt = v; },
    version: SAVE_VERSION,
  };
  return api;
}
