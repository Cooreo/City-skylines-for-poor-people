/**
 * agents.js — pedestrians and vehicles.
 *
 * Design notes
 * ────────────
 * Agents are *cosmetic and derived*: they are never saved, never read by the
 * simulation, and respawn from the current road graph. That keeps saves small
 * and means a loaded city immediately looks alive.
 *
 * Pedestrians walk the pavement (a tile offset from the road centreline) and
 * are spawned from occupied residential tiles, wandering toward commercial or
 * park tiles. Vehicles drive the centreline, spawn at map edges and pick a
 * random connected road tile as a destination.
 *
 * Everything is a fixed-size pool with no allocation in the hot path: the
 * `spawn`/`recycle` pattern below reuses dead slots, so the frame cost is
 * O(alive) and the memory cost is O(pool).
 */

import { TILE_W, TILE_H, } from '../core/state.js';
import { tileToScreen } from './terrain.js';
import { PALETTE } from '../data/palette.js';
import { findRoadPath, collectRoadTiles } from '../systems/grid.js';
import { getDef } from '../data/buildings.js';

const PED_POOL = 220;
const CAR_POOL = 90;

const PED_COLORS = ['#E9776E', '#F2B441', '#7C6FE0', '#56B8E6', '#58C172', '#F2647E', '#FFD166'];
const CAR_COLORS = ['#E24E42', '#4C7CE0', '#F2B441', '#58C172', '#9B8CFF', '#E8EDF5'];

export class Agents {
  constructor(state, rng) {
    this.state = state;
    this.rng = rng;
    this.pedestrians = [];
    this.vehicles = [];
    this.roadTiles = [];
    this.roadVersion = -1;
    this.spawnTimer = 0;
    this._initPools();
  }

  _initPools() {
    for (let i = 0; i < PED_POOL; i++) {
      this.pedestrians.push({ alive: false, x: 0, y: 0, tx: 0, ty: 0, t: 0, speed: 0, color: '#fff', phase: 0, dir: 1 });
    }
    for (let i = 0; i < CAR_POOL; i++) {
      this.vehicles.push({ alive: false, path: null, at: 0, t: 0, speed: 0, color: '#fff', len: 0 });
    }
  }

  /** Rebuild the road-tile cache when the road graph changes. */
  _syncRoads() {
    const b = this.state.grid.buildings;
    const version = this.state.stats.built + this.state.stats.demolished;
    if (version === this.roadVersion) return;
    this.roadVersion = version;
    this.roadTiles = collectRoadTiles(this.state, []);
  }

  /** A random occupied zoned tile to spawn from. */
  _spawnPoint() {
    const b = this.state.grid.buildings;
    const n = b.length;
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = Math.floor(this.rng.next() * n);
      const bl = b[i];
      if (!bl || !bl.anchor) continue;
      const def = getDef(bl.def);
      if (!def || !def.housing) continue;
      if ((bl.occ || 0) < 0.15) continue;
      return i;
    }
    return -1;
  }

  _destination() {
    const b = this.state.grid.buildings;
    const n = b.length;
    for (let attempt = 0; attempt < 24; attempt++) {
      const i = Math.floor(this.rng.next() * n);
      const bl = b[i];
      if (!bl || !bl.anchor) continue;
      const def = getDef(bl.def);
      if (!def) continue;
      if (def.zone === 'commercial' || def.zone === 'park' || def.zone === 'industrial') return i;
    }
    return -1;
  }

  /** Spawn agents to match the population. Called from the game loop. */
  update(dt) {
    this._syncRoads();
    const pop = this.state.city.pop;
    const targetPeds = Math.min(PED_POOL, Math.floor(pop * 0.35));
    const targetCars = Math.min(CAR_POOL, Math.floor(pop * 0.06) + (this.roadTiles.length > 12 ? 4 : 0));

    this.spawnTimer += dt;
    if (this.spawnTimer > 0.25) {
      this.spawnTimer = 0;
      this._spawnPedestrians(targetPeds);
      this._spawnVehicles(targetCars);
    }

    this._stepPedestrians(dt);
    this._stepVehicles(dt);
  }

  _spawnPedestrians(target) {
    let alive = 0;
    for (const p of this.pedestrians) if (p.alive) alive++;
    if (alive >= target) return;
    const from = this._spawnPoint();
    if (from < 0) return;
    const slot = this.pedestrians.find((p) => !p.alive);
    if (!slot) return;
    const w = this.state.grid.w;
    slot.alive = true;
    slot.x = from % w; slot.y = (from / w) | 0;
    slot.tx = slot.x; slot.ty = slot.y;
    slot.t = 0;
    slot.speed = 0.55 + this.rng.next() * 0.5;
    slot.color = PED_COLORS[Math.floor(this.rng.next() * PED_COLORS.length)];
    slot.phase = this.rng.next() * Math.PI * 2;
    slot.dir = 1;
  }

  _spawnVehicles(target) {
    let alive = 0;
    for (const v of this.vehicles) if (v.alive) alive++;
    if (alive >= target) return;
    if (this.roadTiles.length < 4) return;
    const slot = this.vehicles.find((v) => !v.alive);
    if (!slot) return;

    const fromIdx = this.roadTiles[Math.floor(this.rng.next() * this.roadTiles.length)];
    const toIdx = this.roadTiles[Math.floor(this.rng.next() * this.roadTiles.length)];
    const path = findRoadPath(this.state, fromIdx, toIdx);
    if (!path || path.length < 2) return;

    slot.alive = true;
    slot.path = path;
    slot.at = 0;
    slot.t = 0;
    slot.len = path.length;
    slot.speed = 2.2 + this.rng.next() * 1.6;
    slot.color = CAR_COLORS[Math.floor(this.rng.next() * CAR_COLORS.length)];
  }

  _stepPedestrians(dt) {
    for (const p of this.pedestrians) {
      if (!p.alive) continue;
      p.t += dt * p.speed;
      // Bob and sway: a two-frame-ish walk cycle, cheap and readable.
      p.phase += dt * 8 * p.speed;
      if (p.t >= 1) {
        p.t = 0;
        // pick a new nearby destination: a road tile, then drift
        const dest = this._destination();
        if (dest >= 0) {
          const w = this.state.grid.w;
          p.tx = dest % w; p.ty = (dest / w) | 0;
        } else {
          p.tx = p.x + (this.rng.next() - 0.5) * 6;
          p.ty = p.y + (this.rng.next() - 0.5) * 6;
        }
        p.dir = p.tx >= p.x ? 1 : -1;
      }
      p.x += (p.tx - p.x) * Math.min(1, dt * 2.2);
      p.y += (p.ty - p.y) * Math.min(1, dt * 2.2);
    }
  }

  _stepVehicles(dt) {
    const congestion = this.state.city.congestion || 0;
    const speedScale = 1 - congestion * 0.55;
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      v.t += dt * v.speed * speedScale;
      while (v.t >= 1 && v.alive) {
        v.t -= 1;
        v.at++;
        if (v.at >= v.len - 1) {
          // arrived: pick a new trip
          const toIdx = this.roadTiles[Math.floor(this.rng.next() * this.roadTiles.length)];
          const path = findRoadPath(this.state, v.path[v.len - 1], toIdx);
          if (!path || path.length < 2) { v.alive = false; break; }
          v.path = path; v.len = path.length; v.at = 0;
        }
      }
    }
  }

  /* ── drawing ──────────────────────────────────────────────────────────── */

  draw(ctx, time, reduceMotion) {
    const cam = this.state.camera;
    const zoom = cam.zoom;
    // Cull anything well outside the viewport.
    const halfW = (this.state._viewW || 960) / 2 / zoom;
    const halfH = (this.state._viewH || 600) / 2 / zoom;
    const cx = cam.x / (TILE_W / 2), cy = cam.y / (TILE_H / 2);

    this._drawVehicles(ctx, zoom, halfW, halfH, cx, cy, time, reduceMotion);
    this._drawPedestrians(ctx, zoom, halfW, halfH, cx, cy, time, reduceMotion);
  }

  _drawPedestrians(ctx, zoom, halfW, halfH, cx, cy, time, reduceMotion) {
    const scale = Math.max(0.55, zoom);
    for (const p of this.pedestrians) {
      if (!p.alive) continue;
      const { sx, sy } = tileToScreen(p.x, p.y);
      if (Math.abs(sx - cx * TILE_W / 2) > halfW + 40 || Math.abs(sy - cy * TILE_H / 2) > halfH + 40) continue;
      const bob = reduceMotion ? 0 : Math.sin(p.phase) * 1.1;
      const h = 7 * scale;
      // shadow
      ctx.fillStyle = 'rgba(20,26,38,0.22)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 1, 2.4 * scale, 1.2 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      // body
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx, sy - h * 0.5 + bob, 2.1 * scale, 0, Math.PI * 2);
      ctx.fill();
      // legs
      ctx.strokeStyle = PALETTE.uiInk;
      ctx.lineWidth = 1 * scale;
      ctx.beginPath();
      ctx.moveTo(sx - 1, sy - 1 + bob);
      ctx.lineTo(sx - 1 + (reduceMotion ? 0 : Math.sin(p.phase) * 1.4), sy + 2);
      ctx.moveTo(sx + 1, sy - 1 + bob);
      ctx.lineTo(sx + 1 - (reduceMotion ? 0 : Math.sin(p.phase) * 1.4), sy + 2);
      ctx.stroke();
    }
  }

  _drawVehicles(ctx, zoom, halfW, halfH, cx, cy, time, reduceMotion) {
    const scale = Math.max(0.6, zoom);
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const i0 = v.path[v.at];
      const i1 = v.path[Math.min(v.len - 1, v.at + 1)];
      const w = this.state.grid.w;
      const x0 = i0 % w, y0 = (i0 / w) | 0;
      const x1 = i1 % w, y1 = (i1 / w) | 0;
      const t = v.t;
      const { sx: ax, sy: ay } = tileToScreen(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      if (Math.abs(ax - cx * TILE_W / 2) > halfW + 40 || Math.abs(ay - cy * TILE_H / 2) > halfH + 40) continue;

      // heading, so the car rotates to face its direction of travel
      const { sx: bx, sy: by } = tileToScreen(x1, y1);
      const angle = Math.atan2(by - ay, bx - ax);

      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(angle);
      // shadow
      ctx.fillStyle = 'rgba(20,26,38,0.25)';
      ctx.beginPath();
      ctx.ellipse(0, 1.5, 5 * scale, 2.4 * scale, 0, 0, Math.PI * 2);
      ctx.fill();
      // body
      ctx.fillStyle = v.color;
      ctx.beginPath();
      ctx.moveTo(-5 * scale, -2.6 * scale);
      ctx.lineTo(-2 * scale, -3 * scale);
      ctx.lineTo(3 * scale, -2.8 * scale);
      ctx.lineTo(5.4 * scale, -1.4 * scale);
      ctx.lineTo(5.4 * scale, 1.4 * scale);
      ctx.lineTo(3 * scale, 2.8 * scale);
      ctx.lineTo(-2 * scale, 3 * scale);
      ctx.lineTo(-5 * scale, 2.6 * scale);
      ctx.closePath();
      ctx.fill();
      // windscreen
      ctx.fillStyle = 'rgba(20,30,45,0.55)';
      ctx.fillRect(-0.5 * scale, -2 * scale, 3 * scale, 4 * scale);
      // headlights at night
      if (this.state._nightGlow > 0.05) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(255,240,200,${0.5 * this.state._nightGlow})`;
        ctx.beginPath();
        ctx.arc(5.6 * scale, -1.6 * scale, 1.6 * scale, 0, Math.PI * 2);
        ctx.arc(5.6 * scale, 1.6 * scale, 1.6 * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    }
  }

  /** Reset all agents — used when loading a save. */
  reset() {
    for (const p of this.pedestrians) p.alive = false;
    for (const v of this.vehicles) v.alive = false;
    this.roadVersion = -1;
  }
}
