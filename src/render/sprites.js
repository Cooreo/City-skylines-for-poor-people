/**
 * sprites.js — every building drawn procedurally into an offscreen canvas.
 *
 * Why procedural rather than a sprite sheet:
 *   • 4 visual tiers x 17 buildings x 3 variants would be ~200 hand-drawn
 *     assets; procedural gets the same variety from ~40 draw functions.
 *   • Zero binary assets, so the whole game ships as text and loads instantly
 *     from a GitHub Pages deploy with no CDN and no build step.
 *   • Tier changes and new buildings need no art pass.
 *
 * Everything is drawn in "tile space": a TILE_W x (TILE_H + TALL) box whose
 * bottom edge sits on the tile's base diamond, so taller buildings simply
 * extend upward and the painter's algorithm in renderer.js sorts them behind
 * shorter neighbours automatically.
 *
 * Draw functions are pure: same (def, tier, variant, night) in, same pixels
 * out. That is what makes them cacheable.
 */

import { PALETTE, mix, hash01 } from '../data/palette.js';
import { TILE_W, TILE_H } from '../core/state.js';

/** Extra headroom above the tile diamond for tall buildings. */
export const SPRITE_H = 96;

/** Deterministic per-instance jitter so a row of houses is not identical. */
const seedOf = (def, tier, variant, salt = 0) => hash01(tier * 31 + variant * 7 + salt, def.length, salt);

/* ── the registry ───────────────────────────────────────────────────────── */

const DRAW = {
  road: drawRoad,
  residential: drawResidential,
  commercial: drawCommercial,
  industrial: drawIndustrial,
  park: drawPark,
  plaza: drawPlaza,
  civic: drawCivic,
  stadium: drawStadium,
  power: drawPower,
  solar: drawSolar,
  water: drawWaterTower,
  school: drawSchool,
  hospital: drawHospital,
  fire: drawFire,
  police: drawPolice,
  subway: drawSubway,
  tool: drawTool,
};

/**
 * Render (or fetch from cache) the sprite for a building.
 *
 * @param {object} o  { def, tier, variant, night }
 * @returns {{canvas, w, h, anchorY}} cached offscreen canvas
 */
const cache = new Map();

export function getSprite(o) {
  const key = `${o.def}|${o.tier}|${o.variant}|${o.night ? 1 : 0}`;
  let entry = cache.get(key);
  if (entry) return entry;

  const w = TILE_W + 8;
  const h = SPRITE_H + TILE_H + 8;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // The sprite's base sits on the bottom diamond of the tile.
  ctx.save();
  ctx.translate(4, 4 + h - TILE_H / 2 - 4);

  const fn = DRAW[o.def];
  if (fn) fn(ctx, o);

  ctx.restore();
  entry = { canvas, w, h, anchorY: 4 + h - TILE_H / 2 - 4 };
  cache.set(key, entry);
  return entry;
}

export function clearSpriteCache() { cache.clear(); }

function makeCanvas(w, h) {
  const c = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : { width: w, height: h, getContext: () => null };
  c.width = w; c.height = h;
  return c;
}

/* ── shared primitives ──────────────────────────────────────────────────── */

/** Soft drop shadow under a structure. */
function shadow(ctx, spread = 1) {
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = '#0d1220';
  ctx.beginPath();
  ctx.ellipse(0, 0, TILE_W * 0.42 * spread, TILE_H * 0.42 * spread, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** An isometric box: top diamond, left face, right face. */
function isoBox(ctx, { x = 0, y = 0, w = TILE_W, h, depth, top, left, right }) {
  const hw = w / 2, hh = TILE_H / 2;
  // top
  ctx.fillStyle = top;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + hw, y - h - hh);
  ctx.lineTo(x + w, y - h);
  ctx.lineTo(x + hw, y - h + hh);
  ctx.closePath();
  ctx.fill();
  // left
  ctx.fillStyle = left;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + hw, y - h + hh);
  ctx.lineTo(x + hw, y - h + hh + depth);
  ctx.lineTo(x, y - h + depth);
  ctx.closePath();
  ctx.fill();
  // right
  ctx.fillStyle = right;
  ctx.beginPath();
  ctx.moveTo(x + w, y - h);
  ctx.lineTo(x + hw, y - h + hh);
  ctx.lineTo(x + hw, y - h + hh + depth);
  ctx.lineTo(x + w, y - h + depth);
  ctx.closePath();
  ctx.fill();
}

/** A pitched roof over a footprint, drawn as two slanted quads. */
function pitchedRoof(ctx, { x = 0, y = 0, w = TILE_W, h, rise, color, ridge }) {
  const hw = w / 2, hh = TILE_H / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - h);
  ctx.lineTo(x + hw, y - h - hh - rise);
  ctx.lineTo(x + hw, y - h + hh);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + w, y - h);
  ctx.lineTo(x + hw, y - h - hh - rise);
  ctx.lineTo(x + hw, y - h + hh);
  ctx.closePath();
  ctx.fill();
  if (ridge) {
    ctx.strokeStyle = ridge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + hw, y - h - hh - rise);
    ctx.lineTo(x + w, y - h);
    ctx.stroke();
  }
}

/** Windows in a grid on the right-hand face of a box. */
function windows(ctx, { x = 0, y = 0, w = TILE_W, cols, rows, lit, h, depth, offset = 0 }) {
  const hw = w / 2, hh = TILE_H / 2;
  const faceH = depth;
  const faceTop = y - h + hh;
  const ww = 7, wh = 8;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x + hw + 6 + c * (ww + 5) - (cols * (ww + 5)) / 2 + offset;
      const py = faceTop + 8 + r * (wh + 6);
      if (py + wh > faceTop + faceH - 3) continue;
      const on = lit && hash01(r * 13 + c * 7 + offset, cols * 31 + rows, offset) > 0.42;
      ctx.fillStyle = on ? PALETTE.windowGlow : mix(PALETTE.uiPanel2, '#000000', 0.25);
      ctx.fillRect(px, py, ww, wh);
      if (on) {
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = PALETTE.windowGlow;
        ctx.fillRect(px - 1.5, py - 1.5, ww + 3, wh + 3);
        ctx.restore();
      }
    }
  }
}

/** A tree: trunk plus two overlapping leaf blobs. */
function tree(ctx, x, y, scale = 1, sway = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(sway);
  ctx.fillStyle = '#7A5236';
  ctx.fillRect(-1.5 * scale, -12 * scale, 3 * scale, 12 * scale);
  ctx.fillStyle = PALETTE.forest;
  ctx.beginPath();
  ctx.arc(0, -16 * scale, 7 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.forestDark;
  ctx.beginPath();
  ctx.arc(3 * scale, -13 * scale, 5 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ── roads ──────────────────────────────────────────────────────────────── */

function drawRoad(ctx, { night }) {
  const hw = TILE_W / 2, hh = TILE_H / 2;
  // asphalt diamond
  ctx.fillStyle = PALETTE.road;
  ctx.beginPath();
  ctx.moveTo(0, -hh); ctx.lineTo(hw, 0); ctx.lineTo(0, hh); ctx.lineTo(-hw, 0);
  ctx.closePath();
  ctx.fill();
  // kerb highlight
  ctx.strokeStyle = PALETTE.roadDark;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // centre dashes, aligned to the grid
  ctx.fillStyle = PALETTE.roadMark;
  ctx.globalAlpha = 0.55;
  ctx.fillRect(-hw + 8, -1.2, 10, 2.4);
  ctx.fillRect(2, -1.2, 10, 2.4);
  ctx.fillRect(-1.2, -hh + 6, 2.4, 8);
  ctx.fillRect(-1.2, 2, 2.4, 8);
  ctx.globalAlpha = 1;
  // night: street lamp pools
  if (night) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const g = ctx.createRadialGradient(0, 0, 1, 0, 0, hw * 0.9);
    g.addColorStop(0, PALETTE.lampGlow);
    g.addColorStop(1, 'rgba(255,226,174,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, hw * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ── residential ────────────────────────────────────────────────────────── */

function drawResidential(ctx, o) {
  const { tier, variant, night } = o;
  shadow(ctx, 0.8 + tier * 0.12);

  const wall = [PALETTE.residential, '#F2A39C', '#E9776E', '#FFB3AC'][variant % 4];
  const roof = [PALETTE.residentialDark, '#C4564F', '#B04A44', '#9E423C'][variant % 4];

  if (tier === 1) {
    // a small house
    isoBox(ctx, { w: TILE_W * 0.62, h: 16, depth: 20, top: mix(wall, '#ffffff', 0.15), left: wall, right: mix(wall, '#000000', 0.12) });
    pitchedRoof(ctx, { w: TILE_W * 0.62, h: 16, rise: 9, color: roof, ridge: mix(roof, '#000000', 0.3) });
    windows(ctx, { w: TILE_W * 0.62, cols: 2, rows: 1, lit: night, h: 16, depth: 20, offset: 0 });
    // chimney
    ctx.fillStyle = mix(roof, '#000000', 0.2);
    ctx.fillRect(6, -34, 5, 12);
  } else if (tier === 2) {
    isoBox(ctx, { w: TILE_W * 0.72, h: 30, depth: 26, top: mix(wall, '#ffffff', 0.18), left: wall, right: mix(wall, '#000000', 0.12) });
    pitchedRoof(ctx, { w: TILE_W * 0.72, h: 30, rise: 7, color: roof, ridge: mix(roof, '#000000', 0.3) });
    windows(ctx, { w: TILE_W * 0.72, cols: 3, rows: 2, lit: night, h: 30, depth: 26 });
  } else if (tier === 3) {
    // a low apartment block with a flat roof
    isoBox(ctx, { w: TILE_W * 0.78, h: 44, depth: 30, top: mix(PALETTE.sidewalk, '#ffffff', 0.2), left: wall, right: mix(wall, '#000000', 0.12) });
    windows(ctx, { w: TILE_W * 0.78, cols: 3, rows: 3, lit: night, h: 44, depth: 30 });
    ctx.fillStyle = mix(PALETTE.sidewalk, '#000000', 0.1);
    ctx.fillRect(-TILE_W * 0.39, -47, TILE_W * 0.78, 4);
  } else {
    // a tower with a setback and a rooftop strip
    isoBox(ctx, { w: TILE_W * 0.5, h: 40, depth: 34, top: mix(wall, '#ffffff', 0.1), left: mix(wall, '#000000', 0.15), right: mix(wall, '#000000', 0.3) });
    isoBox(ctx, { w: TILE_W * 0.34, h: 66, depth: 22, top: mix(PALETTE.sidewalk, '#ffffff', 0.25), left: wall, right: mix(wall, '#000000', 0.15) });
    windows(ctx, { w: TILE_W * 0.34, cols: 2, rows: 4, lit: night, h: 66, depth: 22 });
    // antenna
    ctx.strokeStyle = PALETTE.uiMuted;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -70);
    ctx.lineTo(0, -82);
    ctx.stroke();
    if (night) {
      ctx.fillStyle = PALETTE.uiDanger;
      ctx.beginPath();
      ctx.arc(0, -84, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // a little garden at tier 1
  if (tier === 1 && variant % 2 === 0) {
    tree(ctx, -18, 6, 0.7, Math.sin(seedOf('residential', tier, variant) * 6) * 0.05);
  }
}

/* ── commercial ─────────────────────────────────────────────────────────── */

function drawCommercial(ctx, o) {
  const { tier, variant, night } = o;
  shadow(ctx, 0.8 + tier * 0.1);
  const wall = [PALETTE.commercial, '#F7C464', '#F2B441', '#FFD98A'][variant % 4];
  const trim = PALETTE.commercialDark;

  if (tier === 1) {
    isoBox(ctx, { w: TILE_W * 0.6, h: 18, depth: 18, top: mix(wall, '#ffffff', 0.2), left: wall, right: mix(wall, '#000000', 0.12) });
    // striped awning
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(-TILE_W * 0.3, -18);
    ctx.lineTo(0, -18 + TILE_H / 2);
    ctx.lineTo(TILE_W * 0.3, -18);
    ctx.lineTo(TILE_W * 0.3, -14);
    ctx.lineTo(0, -14 + TILE_H / 2);
    ctx.lineTo(-TILE_W * 0.3, -14);
    ctx.closePath();
    ctx.fill();
    windows(ctx, { w: TILE_W * 0.6, cols: 2, rows: 1, lit: night, h: 18, depth: 18 });
  } else if (tier === 2) {
    isoBox(ctx, { w: TILE_W * 0.74, h: 34, depth: 26, top: mix(wall, '#ffffff', 0.22), left: wall, right: mix(wall, '#000000', 0.12) });
    // shopfront glazing
    ctx.fillStyle = night ? PALETTE.windowGlow : mix(PALETTE.skyDay, '#ffffff', 0.4);
    ctx.globalAlpha = night ? 0.9 : 0.75;
    ctx.fillRect(-TILE_W * 0.3, -22, TILE_W * 0.6, 12);
    ctx.globalAlpha = 1;
    windows(ctx, { w: TILE_W * 0.74, cols: 3, rows: 2, lit: night, h: 34, depth: 26, offset: 4 });
    // sign board
    ctx.fillStyle = trim;
    ctx.fillRect(-10, -42, 20, 6);
  } else if (tier === 3) {
    isoBox(ctx, { w: TILE_W * 0.8, h: 52, depth: 30, top: mix(wall, '#ffffff', 0.15), left: wall, right: mix(wall, '#000000', 0.14) });
    windows(ctx, { w: TILE_W * 0.8, cols: 4, rows: 3, lit: night, h: 52, depth: 30 });
    ctx.fillStyle = trim;
    ctx.fillRect(-14, -58, 28, 5);
  } else {
    // a glass office tower
    isoBox(ctx, { w: TILE_W * 0.5, h: 46, depth: 32, top: mix(wall, '#ffffff', 0.3), left: mix(wall, '#000000', 0.1), right: mix(wall, '#000000', 0.25) });
    isoBox(ctx, { w: TILE_W * 0.36, h: 78, depth: 24, top: mix(PALETTE.waterTower, '#ffffff', 0.3), left: mix(PALETTE.waterTower, '#000000', 0.05), right: mix(PALETTE.waterTower, '#000000', 0.2) });
    // curtain-wall grid
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    for (let r = 0; r < 5; r++) {
      const yy = -74 + r * 12;
      ctx.beginPath();
      ctx.moveTo(-TILE_W * 0.18, yy);
      ctx.lineTo(TILE_W * 0.18, yy);
      ctx.stroke();
    }
    windows(ctx, { w: TILE_W * 0.36, cols: 3, rows: 5, lit: night, h: 78, depth: 24 });
    // aircraft warning light
    if (night) {
      ctx.fillStyle = PALETTE.uiDanger;
      ctx.beginPath();
      ctx.arc(0, -84, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ── industrial ─────────────────────────────────────────────────────────── */

function drawIndustrial(ctx, o) {
  const { tier, variant, night } = o;
  shadow(ctx, 0.9 + tier * 0.12);
  const wall = [PALETTE.industrial, '#9FACC0', '#8E9BB3', '#B3BECF'][variant % 4];
  const roof = PALETTE.industrialDark;

  if (tier === 1) {
    isoBox(ctx, { w: TILE_W * 0.66, h: 20, depth: 22, top: mix(wall, '#ffffff', 0.2), left: wall, right: mix(wall, '#000000', 0.12) });
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(-TILE_W * 0.33, -20);
    ctx.lineTo(0, -20 - TILE_H / 2 - 4);
    ctx.lineTo(TILE_W * 0.33, -20);
    ctx.lineTo(TILE_W * 0.33, -17);
    ctx.lineTo(0, -17 - TILE_H / 2 - 4);
    ctx.lineTo(-TILE_W * 0.33, -17);
    ctx.closePath();
    ctx.fill();
    windows(ctx, { w: TILE_W * 0.66, cols: 2, rows: 1, lit: night, h: 20, depth: 22 });
  } else if (tier === 2) {
    isoBox(ctx, { w: TILE_W * 0.78, h: 30, depth: 28, top: mix(wall, '#ffffff', 0.2), left: wall, right: mix(wall, '#000000', 0.12) });
    // sawtooth roof
    for (let i = -1; i <= 1; i++) {
      ctx.fillStyle = roof;
      ctx.beginPath();
      ctx.moveTo(i * 14 - 6, -30);
      ctx.lineTo(i * 14, -30 - 8);
      ctx.lineTo(i * 14 + 6, -30);
      ctx.closePath();
      ctx.fill();
    }
    windows(ctx, { w: TILE_W * 0.78, cols: 3, rows: 2, lit: night, h: 30, depth: 28 });
  } else if (tier === 3) {
    isoBox(ctx, { w: TILE_W * 0.82, h: 44, depth: 32, top: mix(wall, '#ffffff', 0.18), left: wall, right: mix(wall, '#000000', 0.14) });
    // chimney with a smoke plume
    ctx.fillStyle = mix(roof, '#000000', 0.25);
    ctx.fillRect(-20, -58, 8, 18);
    ctx.fillStyle = PALETTE.smoke;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(-16 + i * 3, -64 - i * 7, 4 + i * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    windows(ctx, { w: TILE_W * 0.82, cols: 4, rows: 2, lit: night, h: 44, depth: 32 });
  } else {
    // refinery: tank plus gantry
    isoBox(ctx, { w: TILE_W * 0.7, h: 24, depth: 26, top: mix(wall, '#ffffff', 0.2), left: wall, right: mix(wall, '#000000', 0.12) });
    // silo
    ctx.fillStyle = mix(PALETTE.industrial, '#ffffff', 0.25);
    ctx.beginPath();
    ctx.ellipse(10, -34, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PALETTE.industrial;
    ctx.fillRect(1, -34, 18, 16);
    ctx.fillStyle = mix(PALETTE.industrial, '#000000', 0.2);
    ctx.beginPath();
    ctx.ellipse(10, -18, 9, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // gantry
    ctx.strokeStyle = PALETTE.industrialDark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22, -24); ctx.lineTo(-22, -46); ctx.lineTo(14, -46); ctx.lineTo(14, -24);
    ctx.stroke();
    if (night) {
      ctx.fillStyle = PALETTE.windowGlow;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(-19, -40, 4, 4);
      ctx.fillRect(11, -40, 4, 4);
      ctx.globalAlpha = 1;
    }
  }
}

/* ── park ───────────────────────────────────────────────────────────────── */

function drawPark(ctx, o) {
  const { tier, variant, night } = o;
  const hw = TILE_W / 2, hh = TILE_H / 2;
  // lawn
  ctx.fillStyle = mix(PALETTE.park, '#ffffff', 0.06);
  ctx.beginPath();
  ctx.moveTo(0, -hh); ctx.lineTo(hw, 0); ctx.lineTo(0, hh); ctx.lineTo(-hw, 0);
  ctx.closePath();
  ctx.fill();
  // path
  ctx.strokeStyle = PALETTE.sand;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-hw + 6, 0); ctx.lineTo(hw - 6, 0);
  ctx.stroke();

  const count = 1 + tier;
  for (let i = 0; i < count; i++) {
    const t = seedOf('park', tier, variant, i);
    const x = (t - 0.5) * TILE_W * 0.55;
    const y = (seedOf('park', tier, variant, i + 40) - 0.5) * TILE_H * 0.6;
    tree(ctx, x, y, 0.75 + tier * 0.14, Math.sin(t * 9) * 0.06);
  }
  // a bench and a lamp
  ctx.fillStyle = '#8B6B4A';
  ctx.fillRect(-20, -6, 12, 3);
  if (night) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    const g = ctx.createRadialGradient(16, -14, 1, 16, -14, 16);
    g.addColorStop(0, PALETTE.lampGlow);
    g.addColorStop(1, 'rgba(255,226,174,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(16, -14, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = PALETTE.lampGlow;
    ctx.fillRect(15, -14, 3, 12);
  }
}

/* ── plaza (2x2) ────────────────────────────────────────────────────────── */

function drawPlaza(ctx, o) {
  const { tier, night } = o;
  const w = TILE_W * 2, hw = w / 2, hh = TILE_H;
  // paved diamond
  ctx.fillStyle = mix(PALETTE.sand, PALETTE.park, 0.35);
  ctx.beginPath();
  ctx.moveTo(-TILE_W / 2, -TILE_H * 1.5);
  ctx.lineTo(TILE_W / 2 + TILE_W, -TILE_H * 0.5);
  ctx.lineTo(TILE_W / 2, TILE_H * 0.5);
  ctx.lineTo(-TILE_W / 2 - TILE_W, TILE_H * -0.5);
  ctx.closePath();
  ctx.fill();
  // fountain
  ctx.fillStyle = PALETTE.water;
  ctx.beginPath();
  ctx.ellipse(0, 0, TILE_W * 0.34, TILE_H * 0.34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mix(PALETTE.water, '#ffffff', 0.3);
  ctx.beginPath();
  ctx.ellipse(0, -2, TILE_W * 0.24, TILE_H * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
  // tier 2+: an obelisk
  if (tier >= 2) {
    const h = 20 + tier * 12;
    ctx.fillStyle = mix(PALETTE.sand, '#ffffff', 0.3);
    ctx.beginPath();
    ctx.moveTo(-5, -8); ctx.lineTo(5, -8); ctx.lineTo(3, -8 - h); ctx.lineTo(-3, -8 - h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.uiGold;
    ctx.beginPath();
    ctx.moveTo(0, -8 - h - 8); ctx.lineTo(5, -8 - h); ctx.lineTo(-5, -8 - h);
    ctx.closePath();
    ctx.fill();
  }
  // lamps around the edge
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const x = Math.cos(a) * TILE_W * 0.62;
    const y = Math.sin(a) * TILE_H * 0.62;
    ctx.fillStyle = night ? PALETTE.lampGlow : PALETTE.uiMuted;
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (night) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      const g = ctx.createRadialGradient(x, y, 1, x, y, 18);
      g.addColorStop(0, PALETTE.lampGlow);
      g.addColorStop(1, 'rgba(255,226,174,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

/* ── civic (town hall, 2x2) ─────────────────────────────────────────────── */

function drawCivic(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 1.3);
  const wall = PALETTE.civic;
  const w = TILE_W * 1.5;
  isoBox(ctx, { x: -TILE_W * 0.25, w, h: 26 + tier * 8, depth: 30, top: mix(wall, '#ffffff', 0.25), left: wall, right: mix(wall, '#000000', 0.15) });
  // portico
  ctx.fillStyle = mix(PALETTE.sidewalk, '#ffffff', 0.35);
  for (let i = -2; i <= 2; i++) {
    ctx.fillRect(i * 9 - 2, -26 - tier * 8, 4, 26);
  }
  // pediment
  ctx.fillStyle = mix(wall, '#ffffff', 0.4);
  ctx.beginPath();
  ctx.moveTo(-TILE_W * 0.25, -26 - tier * 8);
  ctx.lineTo(-TILE_W * 0.25 + w / 2, -26 - tier * 8 - 16);
  ctx.lineTo(-TILE_W * 0.25 + w, -26 - tier * 8);
  ctx.closePath();
  ctx.fill();
  // clock face
  ctx.fillStyle = PALETTE.uiPanel;
  ctx.beginPath();
  ctx.arc(0, -26 - tier * 8 - 8, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.uiText;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -26 - tier * 8 - 8);
  ctx.lineTo(0, -26 - tier * 8 - 13);
  ctx.stroke();
  windows(ctx, { x: -TILE_W * 0.25, w, cols: 4, rows: 2, lit: night, h: 26 + tier * 8, depth: 30 });
  // flag
  ctx.strokeStyle = PALETTE.uiMuted;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -26 - tier * 8 - 16);
  ctx.lineTo(0, -26 - tier * 8 - 34);
  ctx.stroke();
  ctx.fillStyle = PALETTE.uiAccent;
  ctx.beginPath();
  ctx.moveTo(0, -26 - tier * 8 - 34);
  ctx.lineTo(12, -26 - tier * 8 - 30);
  ctx.lineTo(0, -26 - tier * 8 - 26);
  ctx.closePath();
  ctx.fill();
}

/* ── stadium (2x2) ──────────────────────────────────────────────────────── */

function drawStadium(ctx, o) {
  const { tier, night } = o;
  const w = TILE_W * 1.7, h = 20 + tier * 10;
  // bowl
  ctx.fillStyle = mix(PALETTE.civic, '#000000', 0.1);
  ctx.beginPath();
  ctx.ellipse(0, -h / 2, w / 2, TILE_H * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mix(PALETTE.civic, '#ffffff', 0.2);
  ctx.beginPath();
  ctx.ellipse(0, -h / 2 - 6, w / 2 - 6, TILE_H * 0.62, 0, 0, Math.PI * 2);
  ctx.fill();
  // pitch
  ctx.fillStyle = PALETTE.park;
  ctx.beginPath();
  ctx.ellipse(0, -h / 2 - 6, w / 2 - 16, TILE_H * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  // floodlights
  for (const sx of [-1, 1]) {
    ctx.fillStyle = PALETTE.uiPanel3;
    ctx.fillRect(sx * (w / 2 - 10) - 2, -h - 22, 4, 22);
    ctx.fillStyle = night ? PALETTE.windowGlow : PALETTE.uiMuted;
    ctx.fillRect(sx * (w / 2 - 10) - 6, -h - 28, 12, 6);
    if (night) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      const g = ctx.createRadialGradient(sx * (w / 2 - 10), -h - 25, 2, sx * (w / 2 - 10), -h - 25, 34);
      g.addColorStop(0, PALETTE.lampGlow);
      g.addColorStop(1, 'rgba(255,226,174,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx * (w / 2 - 10), -h - 25, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  // crowd dots at higher tiers
  if (tier >= 2) {
    for (let i = 0; i < 14 * tier; i++) {
      const a = hash01(i, tier, 3) * Math.PI * 2;
      const r = 0.55 + hash01(i, tier, 7) * 0.35;
      ctx.fillStyle = hash01(i, tier, 11) > 0.5 ? PALETTE.residential : PALETTE.commercial;
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (w / 2 - 8) * r, -h / 2 - 6 + Math.sin(a) * TILE_H * 0.5 * r, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}

/* ── power plant (2x2) ──────────────────────────────────────────────────── */

function drawPower(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 1.2);
  const wall = PALETTE.industrial;
  const w = TILE_W * 1.4;
  isoBox(ctx, { x: -TILE_W * 0.2, w, h: 24, depth: 28, top: mix(wall, '#ffffff', 0.2), left: wall, right: mix(wall, '#000000', 0.14) });
  // cooling towers
  const towers = 1 + Math.min(2, tier - 1);
  for (let i = 0; i < towers; i++) {
    const x = -18 + i * 20;
    const h = 30 + tier * 6;
    ctx.fillStyle = mix(PALETTE.industrial, '#ffffff', 0.3);
    ctx.beginPath();
    ctx.moveTo(x - 9, -24);
    ctx.lineTo(x - 5, -24 - h);
    ctx.lineTo(x + 5, -24 - h);
    ctx.lineTo(x + 9, -24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = mix(PALETTE.industrial, '#000000', 0.25);
    ctx.beginPath();
    ctx.ellipse(x, -24 - h, 5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // steam
    ctx.fillStyle = PALETTE.smoke;
    ctx.globalAlpha = 0.45;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(x + (k % 2 ? 3 : -3), -24 - h - 6 - k * 8, 4 + k * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // turbine hall windows
  windows(ctx, { x: -TILE_W * 0.2, w, cols: 4, rows: 2, lit: night, h: 24, depth: 28 });
  // warning stripe
  ctx.fillStyle = PALETTE.power;
  ctx.fillRect(-TILE_W * 0.2, -26, w, 3);
}

/* ── solar farm (2x2) ───────────────────────────────────────────────────── */

function drawSolar(ctx, o) {
  const { tier, night } = o;
  const rows = 1 + Math.min(3, tier);
  for (let r = 0; r < rows; r++) {
    for (let c = -1; c <= 1; c++) {
      const x = c * 20;
      const y = r * 14 - 6;
      ctx.save();
      ctx.translate(x, y);
      // panel
      ctx.fillStyle = night ? mix(PALETTE.waterTower, '#000000', 0.5) : mix(PALETTE.waterTower, '#ffffff', 0.15);
      ctx.beginPath();
      ctx.moveTo(-14, -4); ctx.lineTo(0, -11); ctx.lineTo(14, -4); ctx.lineTo(0, 3);
      ctx.closePath();
      ctx.fill();
      // cell grid
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 0.8;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 5 - 2, -4 + i * 0.4);
        ctx.lineTo(i * 5 + 2, -4 + i * 0.4);
        ctx.stroke();
      }
      // stand
      ctx.fillStyle = PALETTE.uiMuted;
      ctx.fillRect(-1.5, -4, 3, 6);
      ctx.restore();
    }
  }
  // sun glint
  if (!night) {
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(10, -30, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ── water tower ────────────────────────────────────────────────────────── */

function drawWaterTower(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 0.85);
  const h = 34 + tier * 12;
  // legs
  ctx.strokeStyle = PALETTE.waterTowerDark;
  ctx.lineWidth = 2.5;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * 11, 0);
    ctx.lineTo(sx * 4, -h);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(-11, -h * 0.45); ctx.lineTo(11, -h * 0.45);
  ctx.stroke();
  // tank
  ctx.fillStyle = PALETTE.waterTower;
  ctx.beginPath();
  ctx.ellipse(0, -h, 15, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = mix(PALETTE.waterTower, '#ffffff', 0.25);
  ctx.beginPath();
  ctx.ellipse(0, -h - 2, 15, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.waterTowerDark;
  ctx.beginPath();
  ctx.ellipse(0, -h + 5, 15, 7, 0, Math.PI, 0);
  ctx.fill();
  // conical cap
  ctx.fillStyle = PALETTE.waterTowerDark;
  ctx.beginPath();
  ctx.moveTo(0, -h - 16);
  ctx.lineTo(13, -h - 4);
  ctx.lineTo(-13, -h - 4);
  ctx.closePath();
  ctx.fill();
  // level marker
  ctx.fillStyle = PALETTE.uiText;
  ctx.font = '7px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('H2O', 0, -h + 1);
  if (night) {
    ctx.fillStyle = PALETTE.uiAccent;
    ctx.beginPath();
    ctx.arc(0, -h - 18, 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ── school ─────────────────────────────────────────────────────────────── */

function drawSchool(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 0.9);
  const wall = PALETTE.school;
  const w = TILE_W * 0.7;
  isoBox(ctx, { w, h: 22 + tier * 6, depth: 22, top: mix(wall, '#ffffff', 0.25), left: wall, right: mix(wall, '#000000', 0.14) });
  // clock tower
  const th = 22 + tier * 6;
  ctx.fillStyle = mix(wall, '#ffffff', 0.15);
  ctx.fillRect(-6, -th - 18, 12, 18);
  ctx.fillStyle = PALETTE.uiPanel;
  ctx.beginPath();
  ctx.arc(0, -th - 12, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = PALETTE.uiText;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -th - 12); ctx.lineTo(0, -th - 15);
  ctx.stroke();
  pitchedRoof(ctx, { x: -6, w: 12, h: th + 18, rise: 6, color: PALETTE.powerDark, ridge: '#8a5c10' });
  windows(ctx, { w, cols: 3, rows: 1 + tier, lit: night, h: th, depth: 22 });
  // bell
  if (night) {
    ctx.fillStyle = PALETTE.uiGold;
    ctx.beginPath();
    ctx.arc(0, -th - 22, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* ── hospital ───────────────────────────────────────────────────────────── */

function drawHospital(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 1.05);
  const wall = PALETTE.hospital;
  const w = TILE_W * 0.8;
  const h = 30 + tier * 10;
  isoBox(ctx, { w, h, depth: 26, top: mix(wall, '#ffffff', 0.25), left: wall, right: mix(wall, '#000000', 0.14) });
  windows(ctx, { w, cols: 3, rows: 2 + tier, lit: night, h, depth: 26 });
  // red cross sign
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-9, -h - 14, 18, 12);
  ctx.fillStyle = PALETTE.hospital;
  ctx.fillRect(-2, -h - 12, 4, 8);
  ctx.fillRect(-6, -h - 8, 12, 3);
  // entrance canopy
  ctx.fillStyle = mix(PALETTE.sidewalk, '#ffffff', 0.3);
  ctx.fillRect(-TILE_W * 0.4, -6, TILE_W * 0.8, 4);
  if (night) {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = PALETTE.uiRose;
    ctx.fillRect(-2, -h - 12, 4, 8);
    ctx.restore();
  }
}

/* ── fire station ───────────────────────────────────────────────────────── */

function drawFire(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 0.9);
  const wall = PALETTE.fire;
  const w = TILE_W * 0.7;
  const h = 22 + tier * 5;
  isoBox(ctx, { w, h, depth: 22, top: mix(wall, '#ffffff', 0.22), left: wall, right: mix(wall, '#000000', 0.14) });
  // roller shutter doors
  ctx.fillStyle = mix(PALETTE.uiPanel, '#000000', 0.1);
  for (const dx of [-10, 4]) ctx.fillRect(dx, -16, 8, 16);
  ctx.strokeStyle = PALETTE.uiMuted;
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-10, -14 + i * 4); ctx.lineTo(-2, -14 + i * 4);
    ctx.moveTo(4, -14 + i * 4); ctx.lineTo(12, -14 + i * 4);
    ctx.stroke();
  }
  // bell tower
  ctx.fillStyle = mix(wall, '#ffffff', 0.15);
  ctx.fillRect(10, -h - 16, 9, 16);
  pitchedRoof(ctx, { x: 10, w: 9, h: h + 16, rise: 5, color: PALETTE.powerDark });
  windows(ctx, { w, cols: 2, rows: 1, lit: night, h, depth: 22, offset: -12 });
}

/* ── police station ─────────────────────────────────────────────────────── */

function drawPolice(ctx, o) {
  const { tier, night } = o;
  shadow(ctx, 0.9);
  const wall = PALETTE.police;
  const w = TILE_W * 0.72;
  const h = 24 + tier * 7;
  isoBox(ctx, { w, h, depth: 24, top: mix(wall, '#ffffff', 0.25), left: wall, right: mix(wall, '#000000', 0.14) });
  windows(ctx, { w, cols: 3, rows: 1 + tier, lit: night, h, depth: 24 });
  // shield
  ctx.fillStyle = PALETTE.uiGold;
  ctx.beginPath();
  ctx.moveTo(0, -h - 18);
  ctx.lineTo(8, -h - 14);
  ctx.lineTo(8, -h - 8);
  ctx.lineTo(0, -h - 3);
  ctx.lineTo(-8, -h - 8);
  ctx.lineTo(-8, -h - 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = PALETTE.uiInk;
  ctx.font = 'bold 8px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('P', 0, -h - 9);
  // blue lamp at night
  if (night) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    const g = ctx.createRadialGradient(0, -h - 12, 1, 0, -h - 12, 20);
    g.addColorStop(0, '#6E8CFF');
    g.addColorStop(1, 'rgba(110,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -h - 12, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ── metro station ──────────────────────────────────────────────────────── */

function drawSubway(ctx, o) {
  const { tier, night } = o;
  const hw = TILE_W / 2, hh = TILE_H / 2;
  // entrance pit
  ctx.fillStyle = mix(PALETTE.uiPanel, '#000000', 0.3);
  ctx.beginPath();
  ctx.moveTo(0, -hh); ctx.lineTo(hw, 0); ctx.lineTo(0, hh); ctx.lineTo(-hw, 0);
  ctx.closePath();
  ctx.fill();
  // stairs
  ctx.strokeStyle = PALETTE.sidewalk;
  ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(-10 + i * 2, -4 + i * 2);
    ctx.lineTo(10 - i * 2, -4 + i * 2);
    ctx.stroke();
  }
  // roundel sign
  const r = 9 + tier;
  ctx.fillStyle = PALETTE.uiDanger;
  ctx.beginPath();
  ctx.arc(0, -26, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.waterTower;
  ctx.beginPath();
  ctx.arc(0, -26, r * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-r * 0.34, -26 - 1.5, r * 0.68, 3);
  // platform lights at night
  if (night) {
    ctx.save();
    ctx.globalAlpha = 0.4;
    const g = ctx.createRadialGradient(0, -20, 1, 0, -20, 26);
    g.addColorStop(0, PALETTE.lampGlow);
    g.addColorStop(1, 'rgba(255,226,174,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -20, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ── tool placeholder (bulldoze / inspect) ──────────────────────────────── */

function drawTool(ctx, o) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = PALETTE.uiAccent;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, -TILE_H / 2); ctx.lineTo(TILE_W / 2, 0);
  ctx.lineTo(0, TILE_H / 2); ctx.lineTo(-TILE_W / 2, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
