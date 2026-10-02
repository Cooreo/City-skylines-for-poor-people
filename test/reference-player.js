/**
 * reference-player.js — a scripted "reasonable player" used by the headless
 * simulation tests.
 *
 * This is deliberately NOT an AI. It is a checklist of the decisions a
 * competent human makes, in order:
 *
 *   1. Lay a small road network, not the whole map.
 *   2. Build power and water before zoning anything.
 *   3. Zone housing where the market wants it, jobs where unemployment is high.
 *   4. Add civic services as the population milestones unlock them.
 *   5. Add parks when happiness sags.
 *   6. Expand into new ground only once the existing district is full and the
 *      treasury can carry the next phase.
 *
 * If this player cannot grow a city, the balance is wrong. That is the whole
 * point of it: it is the regression test for the economy and the growth curve.
 */

import { place } from '../src/systems/build.js';
import { canPlace } from '../src/systems/grid.js';
import { TERRAIN, idx, countBuildings } from '../src/core/state.js';

/**
 * Growth phases, each a road-grid rectangle inside the build region.
 * A player who paves 800 tiles on turn one has no money left to zone, which
 * is exactly the trap this ordering avoids.
 */
const PHASES = [
  { x0: 0, y0: 0, x1: 19, y1: 16 },
  { x0: 20, y0: 0, x1: 39, y1: 16 },
  { x0: 0, y0: 17, x1: 19, y1: 33 },
  { x0: 20, y0: 17, x1: 39, y1: 33 },
];

export class ReferencePlayer {
  /**
   * @param {object} state   live game state
   * @param {object} opts    { x0, y0, w, h } build region (top-left + size)
   */
  constructor(state, { x0, y0, w, h }) {
    this.state = state;
    this.x0 = x0; this.y0 = y0; this.w = w; this.h = h;
    this.tick = 0;
    this.lastPark = -999;
    this.lastService = {};
    this.phase = 0;
    this.roadsDone = false;
    this.cellsCache = null;
    this.cellsUsed = 0;
    this._flatten();
    this._refreshCells();
  }

  /** The shipped map has water, rock and forest; clear them so we can build. */
  _flatten() {
    const { state, x0, y0, w, h } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const gx = x0 + x, gy = y0 + y;
        if (gx < 0 || gy < 0 || gx >= state.grid.w || gy >= state.grid.h) continue;
        const t = state.grid.terrain[idx(state, gx, gy)];
        if (t === TERRAIN.WATER) state.grid.terrain[idx(state, gx, gy)] = TERRAIN.SAND;
        if (t === TERRAIN.FOREST || t === TERRAIN.ROCK) state.grid.terrain[idx(state, gx, gy)] = TERRAIN.GRASS;
      }
    }
  }

  /** Pave a 3-tile road grid over a rectangle of the region. */
  _roads(rect) {
    const { state, x0, y0 } = this;
    let n = 0;
    for (let y = rect.y0; y <= rect.y1; y += 3) {
      for (let x = rect.x0; x <= rect.x1; x++) {
        if (place(state, 'road', x0 + x, y0 + y).ok) n++;
      }
    }
    for (let x = rect.x0; x <= rect.x1; x += 3) {
      for (let y = rect.y0; y <= rect.y1; y++) {
        if (place(state, 'road', x0 + x, y0 + y).ok) n++;
      }
    }
    return n;
  }

  /**
   * Legal, road-adjacent, non-road build candidates across EVERY paved phase.
   *
   * Caching only the current phase would forget the earlier ones, so the
   * player would abandon finished districts and never fill the map.
   */
  _refreshCells() {
    const { state, x0, y0 } = this;
    const seen = new Set();
    const out = [];
    for (let p = 0; p <= Math.min(this.phase, PHASES.length - 1); p++) {
      const rect = PHASES[p];
      for (let y = rect.y0; y <= rect.y1; y++) {
        for (let x = rect.x0; x <= rect.x1; x++) {
          if (x % 3 === 0 || y % 3 === 0) continue;    // road tile
          const key = y * 1000 + x;
          if (seen.has(key)) continue;
          seen.add(key);
          if (canPlace(state, 'residential', x0 + x, y0 + y).ok) out.push([x0 + x, y0 + y]);
        }
      }
    }
    this.cellsCache = out;
    this.cellsUsed = 0;
  }

  /**
   * Place `defId` on the best legal tile in the region.
   *
   * "Best" means adjacent to a road: a power plant in a far corner supplies
   * the same electricity but covers none of the radius services, which is how
   * a scripted player ends up with 12% health coverage on 2,300 citizens.
   */
  _anywhere(defId) {
    const { state, x0, y0, w, h } = this;
    let fallback = null;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!canPlace(state, defId, x0 + x, y0 + y).ok) continue;
        if (this._touchesRoad(x0 + x, y0 + y)) {
          return place(state, defId, x0 + x, y0 + y).ok;
        }
        fallback ||= [x0 + x, y0 + y];
      }
    }
    return fallback ? place(state, defId, fallback[0], fallback[1]).ok : false;
  }

  _touchesRoad(x, y) {
    const { state } = this;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.grid.w || ny >= state.grid.h) continue;
      const b = state.grid.buildings[ny * state.grid.w + nx];
      if (b && (b.def === 'road' || b.def === 'boulevard')) return true;
    }
    return false;
  }

  /**
   * Place `defId` only when we have fewer than `want` of them already and the
   * last attempt was long enough ago to matter. Prevents service spam, which
   * is the classic way a scripted player bankrupts itself.
   */
  _service(defId, want, cash, gap = 4) {
    if (this.state.economy.cash < cash) return false;
    if (countBuildings(this.state, defId) >= want) return false;
    if (this.tick - (this.lastService[defId] || -99) < gap) return false;
    this.lastService[defId] = this.tick;
    return this._anywhere(defId);
  }

  /** One decision step. Call once per simulation tick. */
  step() {
    const { state } = this;
    const c = state.city;
    const cash = state.economy.cash;
    this.tick = state.tick;

    /* 1. pave the current phase, then utilities, before zoning anything */
    if (!this.roadsDone) {
      this._roads(PHASES[this.phase]);
      this.roadsDone = true;
      this._refreshCells();
    }

    /* 2. expand once this district is full and we can afford the next one */
    const filled = this.cellsCache.length > 0 && this.cellsUsed >= this.cellsCache.length * 0.85;
    if (filled && this.phase < PHASES.length - 1 && cash > 6000 && state.economy.net > 0) {
      this.phase++;
      this._roads(PHASES[this.phase]);
      this._refreshCells();
    }

    /* 3. utilities: keep ratios at 1.0 as the city grows */
    const pop = c.pop;
    this._service('powerPlant', 1 + Math.floor(pop / 200), 500, 6)
      || this._service('solarFarm', 1 + Math.floor(pop / 240), 900, 6);
    this._service('waterTower', 1 + Math.floor(pop / 150), 240, 4);
    this._service('school', 1 + Math.floor(pop / 350), 300, 8);
    this._service('fireStation', 1 + Math.floor(pop / 300), 260, 8);
    this._service('hospital', 1 + Math.floor(pop / 800), 800, 12);
    this._service('policeStation', 1 + Math.floor(pop / 700), 280, 10);
    this._service('subway', 1 + Math.floor(pop / 2000), 700, 16);

    /* 4. parks when morale sags, but never more than the city can enjoy.
          An unbounded park rule bankrupts a scripted player very quickly. */
    const parkBudget = 1 + Math.floor(c.pop / 120);
    if (c.happiness < 55 && c.pop > 60 && cash >= 60
        && countBuildings(state, 'park') < parkBudget
        && this.tick - this.lastPark > 25) {
      if (this._anywhere('park')) this.lastPark = this.tick;
    }

    /* 5. zoning. The gate is cash, not net income: every city builder invests
          ahead of its tax base, and a young settlement always runs a small
          deficit while its first roads and utilities are being paid for. */
    if (cash > 2000) {
      const d = c.demand;
      // Jobs first while anyone is out of work, then whichever zone the
      // market is pulling hardest. A bot that always builds shops never
      // houses anyone, and the city stalls at a few thousand.
      // Build whichever zone the market wants most, but never let the city
      // run short of jobs: unemployment above 5% forces a workplace first.
      // Industry is capped at a third of zoned land: it pollutes its
      // neighbours and only grows while there is spare labour, so an
      // uncapped bot turns the whole map into a smog belt.
      const zc = c.zoneCounts || { residential: 0, commercial: 0, industrial: 0 };
      const zoned = (zc.residential || 0) + (zc.commercial || 0) + (zc.industrial || 0);
      const industryCap = Math.floor(zoned / 3);
      if (c.unemployment > 0.05 && (zc.industrial || 0) < industryCap) {
        const kind = d.industrial >= d.commercial ? 'industrial' : 'commercial';
        if (!this._zone(kind)) this._zone('commercial');
      } else if (d.residential >= d.commercial && d.residential >= d.industrial) {
        if (!this._zone('residential')) this._zone('commercial');
      } else {
        const kind = d.commercial >= d.industrial ? 'commercial' : 'industrial';
        if (!this._zone(kind)) this._zone('residential');
      }
    }
  }

  /** Place one zoned tile on the next free candidate in the current phase. */
  _zone(kind) {
    for (let i = this.cellsUsed; i < this.cellsCache.length; i++) {
      const [x, y] = this.cellsCache[i];
      if (canPlace(this.state, kind, x, y).ok) {
        this.cellsUsed = i + 1;
        return place(this.state, kind, x, y).ok;
      }
    }
    this.cellsUsed = this.cellsCache.length;
    return false;
  }
}
