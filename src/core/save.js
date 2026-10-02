/**
 * save.js — localStorage persistence.
 *
 * Format v3. Terrain is run-length encoded (a 44×44 map collapses to ~60
 * runs); buildings are a sparse tuple array. A typical mid-game save is
 * 6–10 KB of JSON, comfortably inside every browser's quota.
 *
 * Everything here is defensive: a corrupt or truncated save must never take
 * the game down, it must fall back to a fresh world and tell the player.
 *
 * Derived fields (city.*, coverage maps, agent pools) are deliberately NOT
 * saved — they are recomputed on the first tick after load. That keeps the
 * file small and makes old saves resilient to balance changes.
 */

import { SAVE_VERSION, createState, generateTerrain, GRID } from './state.js';
import { BUILDINGS } from '../data/buildings.js';
import { EV } from './eventbus.js';

const KEY = (slot) => `micro-metropolis.v${SAVE_VERSION}.slot.${slot}`;
const INDEX_KEY = `micro-metropolis.v${SAVE_VERSION}.index`;
export const SLOTS = Object.freeze([
  { id: 0, label: 'Autosave', auto: true },
  { id: 1, label: 'Slot 1' },
  { id: 2, label: 'Slot 2' },
  { id: 3, label: 'Slot 3' },
]);

const hasStorage = () => typeof localStorage !== 'undefined';

/* ── encode / decode ────────────────────────────────────────────────────── */

export function rleEncode(arr) {
  const out = [];
  let run = 1;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] === arr[i - 1] && run < 65535) run++;
    else { out.push([arr[i - 1], run]); run = 1; }
  }
  out.push([arr[arr.length - 1], run]);
  return out;
}

export function rleDecode(pairs, length) {
  const out = new Int8Array(length);
  let p = 0;
  for (const [value, count] of pairs) {
    for (let k = 0; k < count && p < length; k++) out[p++] = value;
  }
  return out;
}

export function serialize(state) {
  const buildings = [];
  const b = state.grid.buildings;
  for (let i = 0; i < b.length; i++) {
    const inst = b[i];
    if (!inst) continue;
    buildings.push([
      i, inst.def, inst.tier, inst.variant,
      Math.round((inst.occ || 0) * 1000) / 1000,
      inst.anchor ? 1 : 0, inst.ox || 0, inst.oy || 0,
      inst.tickBuilt == null ? state.tick : inst.tickBuilt,
    ]);
  }

  return {
    v: SAVE_VERSION,
    savedAt: Date.now(),
    seed: state.seed,
    rngState: state.rngState,
    tick: state.tick,
    day: state.day,
    clock: state.clock,
    season: state.season,
    speed: state.speed,
    economy: {
      cash: state.economy.cash,
      taxLevel: state.economy.taxLevel,
      everDeficit: state.economy.everDeficit,
      deficitStreak: state.economy.deficitStreak,
      loans: state.economy.loans,
      totalEarned: state.economy.totalEarned,
      totalSpent: state.economy.totalSpent,
      history: state.economy.history.slice(-30),
    },
    grid: {
      w: state.grid.w,
      h: state.grid.h,
      terrain: rleEncode(state.grid.terrain),
      buildings,
    },
    unlocked: state.unlocked,
    seenMilestones: state.seenMilestones,
    won: state.won,
    victoryMedals: state.victoryMedals,
    deck: {
      cooldowns: state.deck.cooldowns,
      lastFired: state.deck.lastFired,
      history: state.deck.history.slice(-20),
      active: null,               // never persist an open card
    },
    modifiers: state.modifiers,
    stats: state.stats,
    settings: state.settings,
    tool: state.tool,
  };
}

/** Rebuild a live state tree from a serialized payload. */
export function deserialize(data, bus) {
  if (!data || data.v !== SAVE_VERSION) {
    throw new Error(`Save version mismatch (found ${data && data.v}, want ${SAVE_VERSION})`);
  }
  const state = createState({ seed: data.seed });

  state.rngState = data.rngState || state.rngState;
  state.tick = data.tick | 0;
  state.day = data.day | 0;
  state.clock = typeof data.clock === 'number' ? data.clock : state.clock;
  state.season = data.season || state.season;
  state.speed = typeof data.speed === 'number' ? data.speed : 1;

  Object.assign(state.economy, data.economy || {});
  state.economy.history = (data.economy && data.economy.history) || [];

  const gw = data.grid.w, gh = data.grid.h;
  if (gw === GRID.w && gh === GRID.h) {
    state.grid.terrain = rleDecode(data.grid.terrain, gw * gh);
    state.grid.height = generateTerrain(gw, gh, data.seed).height;
  } else {
    // Older/newer map size: regenerate terrain, keep the buildings that fit.
    const gen = generateTerrain(gw, gh, data.seed);
    state.grid.w = gw; state.grid.h = gh;
    state.grid.terrain = gen.terrain; state.grid.height = gen.height;
    state.grid.buildings = new Array(gw * gh).fill(null);
  }

  let maxId = 0;
  for (const row of data.grid.buildings) {
    const [i, def, tier, variant, occ, anchor, ox, oy, tickBuilt] = row;
    if (i < 0 || i >= state.grid.buildings.length) continue;
    if (!BUILDINGS[def]) continue;            // unknown id from an older build
    state.grid.buildings[i] = {
      id: maxId++,
      def,
      tier: Math.max(1, Math.min(BUILDINGS[def].tiers, tier || 1)),
      variant: variant || 0,
      occ: occ || 0,
      powered: true,
      watered: true,
      svc: {},
      anchor: !!anchor,
      ox: ox || 0,
      oy: oy || 0,
      tickBuilt: tickBuilt == null ? 0 : tickBuilt,
      bornAt: 0,
    };
  }

  state.unlocked = Array.isArray(data.unlocked) ? data.unlocked.slice() : state.unlocked;
  state.seenMilestones = Array.isArray(data.seenMilestones) ? data.seenMilestones.slice() : [];
  state.won = !!data.won;
  state.victoryMedals = data.victoryMedals || [];
  state.deck.cooldowns = (data.deck && data.deck.cooldowns) || {};
  state.deck.lastFired = (data.deck && data.deck.lastFired) || -999;
  state.deck.history = (data.deck && data.deck.history) || [];
  state.deck.active = null;
  state.modifiers = Array.isArray(data.modifiers) ? data.modifiers : [];
  state.stats = Object.assign(state.stats, data.stats || {});
  state.settings = Object.assign(state.settings, data.settings || {});
  state.tool = data.tool && BUILDINGS[data.tool] ? data.tool : 'road';
  state.dirty.terrain = true;
  state.dirty.sprites = true;

  if (bus) bus.emit(EV.LOAD, state);
  return state;
}

/* ── storage ────────────────────────────────────────────────────────────── */

export function save(state, slot = 1) {
  if (!hasStorage()) return { ok: false, reason: 'localStorage unavailable' };
  try {
    const payload = JSON.stringify(serialize(state));
    localStorage.setItem(KEY(slot), payload);
    writeIndex(slot, state, payload.length);
    if (state.bus) state.bus.emit(EV.SAVE, { slot, bytes: payload.length });
    return { ok: true, bytes: payload.length };
  } catch (err) {
    console.error('[save]', err);
    return { ok: false, reason: err.name === 'QuotaExceededError' ? 'Storage full' : String(err.message || err) };
  }
}

export function load(slot, bus) {
  if (!hasStorage()) return null;
  const raw = localStorage.getItem(KEY(slot));
  if (!raw) return null;
  try {
    return deserialize(JSON.parse(raw), bus);
  } catch (err) {
    console.error('[load]', err);
    return null;
  }
}

export function hasSave(slot) {
  if (!hasStorage()) return false;
  return !!localStorage.getItem(KEY(slot));
}

export function deleteSave(slot) {
  if (!hasStorage()) return;
  localStorage.removeItem(KEY(slot));
}

export function listSaves() {
  if (!hasStorage()) return [];
  return SLOTS.map((s) => {
    const raw = localStorage.getItem(KEY(s.id));
    if (!raw) return { ...s, exists: false };
    try {
      const data = JSON.parse(raw);
      return {
        ...s, exists: true,
        savedAt: data.savedAt,
        pop: null,
        day: data.day,
        cash: data.economy && data.economy.cash,
        bytes: raw.length,
        tick: data.tick,
      };
    } catch {
      return { ...s, exists: true, corrupt: true };
    }
  });
}

/** Small index so the load screen can show summaries without parsing saves. */
function writeIndex(slot, state, bytes) {
  try {
    const index = JSON.parse(localStorage.getItem(INDEX_KEY) || '{}');
    index[slot] = {
      savedAt: Date.now(),
      day: state.day,
      pop: state.city.pop,
      cash: Math.round(state.economy.cash),
      happiness: Math.round(state.city.happiness),
      bytes,
    };
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch { /* index is cosmetic; ignore */ }
}

export function readIndex() {
  if (!hasStorage()) return {};
  try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); } catch { return {}; }
}

export { KEY as slotKey, SAVE_VERSION };
