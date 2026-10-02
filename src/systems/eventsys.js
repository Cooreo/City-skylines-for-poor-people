/**
 * eventsys.js — the event deck: scheduling, eligibility, resolution.
 *
 * The deck is data (data/events.js); this module is the machinery around it.
 *
 * Scheduling rules
 * ────────────────
 *   • At most one card is open at a time; the simulation halts while it is.
 *   • A card may only fire after MIN_GAP ticks without one.
 *   • Each card has its own cooldown and a `requires()` predicate, so a
 *     brand-new settlement never sees a "Rent Protest".
 *   • Weighted random from the eligible pool; `weight` is a relative pull,
 *     not a probability.
 */

import { EVENTS } from '../data/events.js';
import { addModifier, addMood } from './modifiers.js';
import { transfer, takeLoan, formatMoney, MAX_EMERGENCY_LOANS } from './economy.js';
import { countBuildings, } from '../core/state.js';
import { getDef } from '../data/buildings.js';
import { place, findSpot, roadKeySet, removeInstance } from './build.js';
import { EV } from '../core/eventbus.js';

export const MIN_GAP = 14;       // ticks between cards
export const FIRST_EVENT_TICK = 20;

export function update(state, rng, bus) {
  const deck = state.deck;
  if (deck.active) return;                       // a card is already open
  if (state.tick < FIRST_EVENT_TICK) return;
  if (state.tick - deck.lastFired < MIN_GAP) return;
  if (state.won) return;

  const ctx = makeContext(state, rng);
  const pool = [];
  let total = 0;
  for (const e of EVENTS) {
    const ready = (deck.cooldowns[e.id] || 0) <= state.tick;
    if (!ready) continue;
    let ok = true;
    try { ok = e.requires(ctx); } catch { ok = false; }
    if (!ok) continue;
    pool.push(e);
    total += e.weight;
  }
  if (!pool.length) return;

  let r = rng.next() * total;
  let chosen = pool[pool.length - 1];
  for (const e of pool) { r -= e.weight; if (r <= 0) { chosen = e; break; } }

  deck.active = chosen.id;
  deck.lastFired = state.tick;
  deck.cooldowns[chosen.id] = state.tick + chosen.cooldown;
  bus.emit(EV.EVENT_SHOW, chosen);
}

/**
 * Apply the player's choice. `choiceIndex` is validated; an out-of-range
 * index is a no-op rather than a crash (a stale UI click must never break a
 * session).
 */
export function resolve(state, choiceIndex, bus) {
  const deck = state.deck;
  if (!deck.active) return null;
  const event = EVENTS.find((e) => e.id === deck.active);
  if (!event) { deck.active = null; return null; }

  const choice = event.choices[choiceIndex];
  if (!choice) return null;

  const ctx = makeContext(state, state.rng || null);
  let result = '';
  try {
    result = choice.run(ctx) || '';
  } catch (err) {
    console.error('[event]', event.id, err);
    result = 'The city muddled through.';
  }

  deck.history.push({ id: event.id, title: event.title, choice: choice.label, result, tick: state.tick, day: state.day });
  if (deck.history.length > 40) deck.history.shift();
  deck.active = null;
  state.stats.eventsResolved++;

  bus.emit(EV.EVENT_RESOLVE, { eventId: event.id, choiceIndex, result, title: event.title });
  return result;
}

/** True while a card is open — the game loop skips simulation while so. */
export const isBlocked = (state) => !!state.deck.active;

/* ── the ctx handed to event choice functions ───────────────────────────── */

function makeContext(state, rng) {
  const fallbackRng = rng || { next: () => Math.random() };

  const ctx = {
    // Callable, not the rng object: data/events.js writes `c.rng() < 0.45`.
    rng: () => fallbackRng.next(),
    get state() {
      return {
        pop: state.city.pop,
        happiness: state.city.happiness,
        cash: state.economy.cash,
        day: state.day,
        season: state.season,
        taxLevel: state.economy.taxLevel,
        pollution: state.city.pollution,
        congestion: state.city.congestion,
        powerRatio: state.city.powerRatio,
        waterRatio: state.city.waterRatio,
        unemployment: state.city.unemployment,
      };
    },
    cash(n) { return transfer(state, n, 'event'); },
    mood(n, ticks) { addMood(state, n, ticks); },
    mod(key, value, ticks) { addModifier(state, key, value, ticks); },
    demand(zone, value, ticks) { addModifier(state, `demand_${zone}`, value, ticks); },
    countBuilding(id) { return countBuildings(state, id); },
    /**
     * Borrow from the treasury; interest is added to upkeep. Event loans count
     * toward the same emergency cap as the automatic safety net, otherwise a
     * card that fires during a deficit becomes an unbounded debt faucet.
     */
    loan(amount) {
      const emergencyCount = state.economy.loans.filter((l) => l.emergency).length;
      if (emergencyCount >= MAX_EMERGENCY_LOANS) {
        // Out of credit: the only thing on offer is austerity.
        state.economy.cash = Math.max(state.economy.cash, 0);
        return 'the treasury is tapped out';
      }
      const loan = takeLoan(state, amount);
      loan.emergency = true;
      return loan ? formatMoney(loan.principal) : '¤0';
    },
    hasService(key) {
      const b = state.grid.buildings;
      for (let i = 0; i < b.length; i++) {
        const def = b[i] && getDef(b[i].def);
        if (def && def.service && def.service.key === key) return true;
      }
      return false;
    },
    coveredRatio(key) { return state.city.coverage[key] || 0; },
    affected(defId) {
      const out = [];
      const b = state.grid.buildings;
      const w = state.grid.w;
      for (let i = 0; i < b.length; i++) {
        if (b[i] && b[i].def === defId) out.push({ ...b[i], x: i % w, y: (i / w) | 0, i });
      }
      return out;
    },
    /** Place a free building of `defId` on the best available tile. */
    spawn(defId) {
      const spot = findSpot(state, defId, fallbackRng, roadKeySet(state));
      if (!spot) return null;
      const r = place(state, defId, spot.x, spot.y, { free: true });
      return r.ok ? spot : null;
    },
    /** Remove up to `n` instances, preferring ones with no coverage. */
    destroyRandom(defId, n = 1, coverageKey = null) {
      const list = ctx.affected(defId);
      if (!list.length) return 0;
      const uncovered = coverageKey ? list.filter((b) => !(b.svc && b.svc[coverageKey])) : [];
      const from = uncovered.length ? uncovered : list;
      let removed = 0;
      for (let k = 0; k < n && from.length; k++) {
        const pick = from.splice(Math.floor(fallbackRng.next() * from.length), 1)[0];
        if (removeInstance(state, pick.x, pick.y)) {
          removed++;
          if (state.bus) state.bus.emit(EV.DEMOLISH, { x: pick.x, y: pick.y, defId, reason: 'event' });
        }
      }
      state.dirty.sprites = true;
      return removed;
    },
  };
  return ctx;
}

/** Cooldown ticks remaining per event id — used by the debug overlay. */
export function cooldowns(state) {
  const out = {};
  for (const id in state.deck.cooldowns) {
    const left = state.deck.cooldowns[id] - state.tick;
    if (left > 0) out[id] = left;
  }
  return out;
}
