/**
 * terrain.js — the ground layer.
 *
 * Drawn once into an offscreen canvas whenever the terrain changes (which is
 * only when the player bulldozes forest or rock). The per-frame cost of the
 * ground is then a single `drawImage`, which is what keeps the render loop
 * inside a 60fps budget on a 44x44 map.
 *
 * Tile art
 * ────────
 * Each tile is a diamond with a subtle height offset so the island reads as
 * terrain rather than a flat grid. Grass gets per-tile tufts from a hash, sand
 * gets speckles, water gets two animated wave bands, forest and rock get
 * scatter marks. All of it is procedural.
 */

import { PALETTE, hash01, } from '../data/palette.js';
import { TILE_W, TILE_H, TERRAIN, idx } from '../core/state.js';

let ground = null;      // offscreen canvas
let groundDirty = true;

export function invalidateTerrain() { groundDirty = true; }

/** Screen position of a tile's top corner. */
export function tileToScreen(x, y) {
  return { sx: (x - y) * (TILE_W / 2), sy: (x + y) * (TILE_H / 2) };
}

/** Inverse of tileToScreen. Returns fractional tile coordinates. */
export function screenToTile(sx, sy) {
  const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

function makeGround(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : { width: 1, height: 1 };
  c.width = w; c.height = h;
  return c;
}

/**
 * Render the whole terrain into `ground`, sized to fit the map.
 * Called only when the terrain actually changes.
 */
export function renderTerrain(state) {
  const { w: gw, h: gh, terrain, height } = state.grid;
  const pad = TILE_W * 2;
  const W = (gw + gh) * (TILE_W / 2) + pad * 2;
  const H = (gw + gh) * (TILE_H / 2) + TILE_H * 3 + pad * 2;

  if (!ground) ground = makeGround(W, H);
  ground.width = W; ground.height = H;
  const ctx = ground.getContext('2d');
  if (!ctx) return null;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(pad + gh * (TILE_W / 2), pad + TILE_H);

  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = idx(state, x, y);
      const t = terrain[i];
      const { sx, sy } = tileToScreen(x, y);
      // Height offset: lifts the whole island slightly in the middle.
      const lift = (height[i] - 0.5) * 5;
      drawTile(ctx, sx, sy + lift, t, x, y, state);
    }
  }
  ctx.restore();
  groundDirty = false;
  return { canvas: ground, w: W, h: H, padX: pad + gh * (TILE_W / 2), padY: pad + TILE_H };
}

function drawTile(ctx, sx, sy, t, x, y, state) {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  ctx.beginPath();
  ctx.moveTo(sx, sy - hh);
  ctx.lineTo(sx + hw, sy);
  ctx.lineTo(sx, sy + hh);
  ctx.lineTo(sx - hw, sy);
  ctx.closePath();

  const n = hash01(x, y, 1);
  switch (t) {
    case TERRAIN.WATER: {
      ctx.fillStyle = n > 0.5 ? PALETTE.water : PALETTE.waterDeep;
      ctx.fill();
      break;
    }
    case TERRAIN.SAND: {
      ctx.fillStyle = n > 0.5 ? PALETTE.sand : PALETTE.sandDark;
      ctx.fill();
      speckle(ctx, sx, sy, PALETTE.sandDark, x, y, 5, 0.5);
      break;
    }
    case TERRAIN.ROCK: {
      ctx.fillStyle = n > 0.5 ? PALETTE.rock : PALETTE.rockDark;
      ctx.fill();
      ctx.fillStyle = PALETTE.rockDark;
      ctx.beginPath();
      ctx.moveTo(sx - 6, sy + 2);
      ctx.lineTo(sx, sy - 5);
      ctx.lineTo(sx + 7, sy + 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case TERRAIN.FOREST: {
      ctx.fillStyle = n > 0.5 ? PALETTE.grassAlt : PALETTE.grass;
      ctx.fill();
      tufts(ctx, sx, sy, x, y);
      break;
    }
    default: {
      ctx.fillStyle = n > 0.5 ? PALETTE.grass : PALETTE.grassAlt;
      ctx.fill();
      tufts(ctx, sx, sy, x, y);
      // a lighter rim where the tile meets water reads as a shoreline
      break;
    }
  }
}

function tufts(ctx, sx, sy, x, y) {
  ctx.fillStyle = PALETTE.grassDark;
  ctx.globalAlpha = 0.5;
  const count = 3;
  for (let i = 0; i < count; i++) {
    const hx = hash01(x, y, 10 + i);
    const hy = hash01(x, y, 40 + i);
    ctx.fillRect(sx - 12 + hx * 24, sy - 6 + hy * 12, 2, 3);
  }
  ctx.globalAlpha = 1;
}

function speckle(ctx, sx, sy, color, x, y, count, alpha) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const hx = hash01(x, y, 70 + i);
    const hy = hash01(x, y, 90 + i);
    ctx.fillRect(sx - 10 + hx * 20, sy - 5 + hy * 10, 1.5, 1.5);
  }
  ctx.globalAlpha = 1;
}

/** Animated wave highlights, drawn over the static ground each frame. */
export function drawWaves(ctx, state, camera, time) {
  const { w: gw, h: gh, terrain } = state.grid;
  const hw = TILE_W / 2, hh = TILE_H / 2;
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (terrain[idx(state, x, y)] !== TERRAIN.WATER) continue;
      const { sx, sy } = tileToScreen(x, y);
      const phase = (x + y) * 0.7 + time * 1.6;
      const off = Math.sin(phase) * 2;
      ctx.fillStyle = PALETTE.waterFoam;
      ctx.fillRect(sx - 8 + off, sy - 1, 6, 1.6);
      ctx.fillRect(sx + 3 - off, sy + 2, 5, 1.4);
    }
  }
  ctx.restore();
}

export { ground as groundCanvas };
