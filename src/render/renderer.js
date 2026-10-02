/**
 * renderer.js — the frame pipeline.
 *
 * Passes, in order:
 *   1. sky gradient          (the day/night backdrop)
 *   2. ground                (cached terrain canvas, one drawImage)
 *   3. water animation       (wave highlights)
 *   4. coverage overlay      (service radius tint, when enabled)
 *   5. buildings             (painter's algorithm: back to front)
 *   6. road markings         (drawn on top of buildings so lanes read)
 *   7. citizens & vehicles   (see agents.js)
 *   8. particles             (construction dust, coins, hearts)
 *   9. night pass            (multiply tint + window/lamp glow)
 *  10. build ghost           (placement preview + validity tint)
 *  11. hover / selection     (tile highlight + inspector reticle)
 *
 * The renderer owns no game state. It reads `state` and writes pixels; every
 * mutation goes through the systems. That is what lets the headless tests run
 * the whole game with no canvas at all.
 */

import { PALETTE, withAlpha } from '../data/palette.js';
import { TILE_W, TILE_H, idx, inBounds } from '../core/state.js';
import { getDef, } from '../data/buildings.js';
import { tileToScreen } from './terrain.js';
import { getSprite } from './sprites.js';
import * as daynight from '../systems/daynight.js';

export class Renderer {
  constructor(canvas, state, clock) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.state = state;
    this.clock = clock;
    this.dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    this.time = 0;
    this.frame = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this.agents = null;     // injected: { pedestrians, vehicles }
    this.particles = null;  // injected
    this.hoverTile = null;
    this.ghost = null;      // { defId, x, y, ok, reason }
    this.showGrid = false;
    this.showCoverage = null;
    this.reduceMotion = false;
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 960;
    const h = this.canvas.clientHeight || 600;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.viewW = w;
    this.viewH = h;
  }

  /** Camera follows its target with easing, then we clamp to the map bounds. */
  updateCamera(dt) {
    const cam = this.state.camera;
    const k = 1 - Math.pow(0.0015, dt);
    cam.x += (cam.tx - cam.x) * k;
    cam.y += (cam.ty - cam.y) * k;
    cam.zoom += (cam.tzoom - cam.zoom) * k;
    this.clampCamera();
  }

  clampCamera() {
    const cam = this.state.camera;
    const { w: gw, h: gh } = this.state.grid;
    const mapW = (gw + gh) * (TILE_W / 2) * cam.zoom;
    const mapH = (gw + gh) * (TILE_H / 2) * cam.zoom + TILE_H * 4 * cam.zoom;
    const halfW = this.viewW / 2, halfH = this.viewH / 2;
    cam.x = mapW <= this.viewW ? mapW / 2 : Math.max(halfW, Math.min(mapW - halfW, cam.x));
    cam.y = mapH <= this.viewH ? mapH / 2 : Math.max(halfH, Math.min(mapH - halfH, cam.y));
  }

  /** World point -> canvas pixels. */
  worldToScreen(sx, sy) {
    const cam = this.state.camera;
    return {
      x: (sx - cam.x) * cam.zoom + this.viewW / 2,
      y: (sy - cam.y) * cam.zoom + this.viewH / 2,
    };
  }

  /** Canvas pixels -> fractional tile coordinates. */
  screenToTile(px, py) {
    const cam = this.state.camera;
    const sx = (px - this.viewW / 2) / cam.zoom + cam.x;
    const sy = (py - this.viewH / 2) / cam.zoom + cam.y;
    const a = sx / (TILE_W / 2), b = sy / (TILE_H / 2);
    return { x: (a + b) / 2, y: (b - a) / 2 };
  }

  /** One full frame. `dt` in seconds. */
  render(dt) {
    const ctx = this.ctx;
    this.time += dt;
    this.frame++;
    this._fpsAccum += dt;
    this._fpsFrames++;
    if (this._fpsAccum >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAccum);
      this._fpsAccum = 0; this._fpsFrames = 0;
    }

    const cam = this.state.camera;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    this.drawSky(ctx);
    this.drawGround(ctx);

    ctx.save();
    ctx.translate(this.viewW / 2 - cam.x * cam.zoom, this.viewH / 2 - cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);

    this.drawCoverage(ctx);
    this.drawBuildings(ctx);
    if (this.showGrid) this.drawGrid(ctx);
    this.drawGhost(ctx);
    this.drawHover(ctx);
    if (this.agents) this.agents.draw(ctx, this.time, this.reduceMotion);
    if (this.particles) this.particles.draw(ctx);

    ctx.restore();

    this.drawNight(ctx);
    this.drawVignette(ctx);
    ctx.restore();
  }

  /* ── passes ───────────────────────────────────────────────────────────── */

  drawSky(ctx) {
    const { top, bot } = daynight.skyColors(this.clock.clock);
    const g = ctx.createLinearGradient(0, 0, 0, this.viewH);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  drawGround(ctx) {
    const mod = this.state._terrainLayer;
    if (!mod) return;
    const cam = this.state.camera;
    const p = this.worldToScreen(0, 0);
    // The terrain canvas is pre-translated so tile (0,0) sits at its origin.
    ctx.drawImage(
      mod.canvas,
      p.x - mod.padX * cam.zoom,
      p.y - mod.padY * cam.zoom,
      mod.w * cam.zoom,
      mod.h * cam.zoom
    );
  }

  drawGrid(ctx) {
    const { w: gw, h: gh } = this.state.grid;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 0.6;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const { sx, sy } = tileToScreen(x, y);
        ctx.beginPath();
        ctx.moveTo(sx, sy - TILE_H / 2);
        ctx.lineTo(sx + TILE_W / 2, sy);
        ctx.lineTo(sx, sy + TILE_H / 2);
        ctx.lineTo(sx - TILE_W / 2, sy);
        ctx.closePath();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** Service coverage tint, colour-coded by which service is inspected. */
  drawCoverage(ctx) {
    const key = this.showCoverage;
    if (!key) return;
    const { w: gw, h: gh, buildings } = this.state.grid;
    const color = {
      health: PALETTE.hospital, education: PALETTE.school,
      safety: PALETTE.police, transit: PALETTE.subway,
    }[key] || PALETTE.uiAccent;

    ctx.save();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = idx(this.state, x, y);
        const b = buildings[i];
        if (!b) continue;
        const def = getDef(b.def);
        if (!def || (def.zone !== 'residential' && def.zone !== 'commercial' && def.zone !== 'industrial')) continue;
        const on = b.svc && b.svc[key];
        if (!on) continue;
        const { sx, sy } = tileToScreen(x, y);
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(sx, sy - TILE_H / 2);
        ctx.lineTo(sx + TILE_W / 2, sy);
        ctx.lineTo(sx, sy + TILE_H / 2);
        ctx.lineTo(sx - TILE_W / 2, sy);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Painter's algorithm: sort by (x + y) so nearer tiles draw later. */
  drawBuildings(ctx) {
    const { w: gw, h: gh, buildings } = this.state.grid;
    const night = this.clock.phase === 'night' || this.clock.phase === 'dusk';
    const order = [];
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const b = buildings[idx(this.state, x, y)];
        if (!b) continue;
        // Only the anchor tile draws; the rest of the footprint is implied.
        if (!b.anchor) continue;
        order.push({ x, y, b });
      }
    }
    order.sort((a, b) => (a.x + a.y) - (b.x + b.y));

    for (const { x, y, b } of order) {
      const def = getDef(b.def);
      if (!def) continue;
      const sprite = getSprite({
        def: def.sprite, tier: b.tier, variant: b.variant || 0, night,
      });
      const { sx, sy } = tileToScreen(x, y);
      // A 2x2 structure draws its art centred on the FOOTPRINT, not on its
      // anchor tile: without this offset a plaza sits half a tile high and
      // half a tile left of the ground it covers.
      const cx = sx + (def.w - def.h) * (TILE_W / 4);
      const cy = sy + (def.w + def.h - 2) * (TILE_H / 4);
      ctx.drawImage(sprite.canvas, cx - sprite.w / 2, cy - sprite.anchorY, sprite.w, sprite.h);
      if (this.state.selection && this.state.selection.x === x && this.state.selection.y === y) {
        this.drawSelectionReticle(ctx, sx, sy, def);
      }
    }
  }

  drawSelectionReticle(ctx, sx, sy, def) {
    ctx.save();
    ctx.strokeStyle = PALETTE.uiAccent;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -this.time * 22;
    const hw = (TILE_W / 2) * def.w, hh = (TILE_H / 2) * def.h;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** Placement preview: green when legal, red with a reason when not. */
  drawGhost(ctx) {
    const g = this.ghost;
    if (!g) return;
    const def = getDef(g.defId);
    if (!def) return;
    const { sx, sy } = tileToScreen(g.x, g.y);
    const hw = (TILE_W / 2) * def.w, hh = (TILE_H / 2) * def.h;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g.ok ? PALETTE.uiAccent : PALETTE.uiDanger;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = g.ok ? '#ffffff' : '#ffd7da';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    if (def.sprite && def.sprite !== 'tool') {
      const sprite = getSprite({ def: def.sprite, tier: 1, variant: 0, night: false });
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.drawImage(sprite.canvas, sx - sprite.w / 2, sy - sprite.anchorY);
      ctx.restore();
    }
  }

  drawHover(ctx) {
    const t = this.hoverTile;
    if (!t || !inBounds(this.state, t.x, t.y)) return;
    const { sx, sy } = tileToScreen(t.x, t.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - TILE_H / 2);
    ctx.lineTo(sx + TILE_W / 2, sy);
    ctx.lineTo(sx, sy + TILE_H / 2);
    ctx.lineTo(sx - TILE_W / 2, sy);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** Night: a multiply tint plus additive window and lamp light. */
  drawNight(ctx) {
    const clock = this.clock.clock;
    const alpha = daynight.nightAlpha(clock);
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = withAlpha('#2a3560', 1);
    ctx.globalAlpha = alpha;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.restore();

    // Additive glow from lit windows and street lamps.
    const glow = daynight.windowGlow(clock);
    if (glow <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cam = this.state.camera;
    ctx.translate(this.viewW / 2 - cam.x * cam.zoom, this.viewH / 2 - cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
    const { w: gw, h: gh, buildings } = this.state.grid;
    const night = true;
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const b = buildings[idx(this.state, x, y)];
        if (!b || !b.anchor) continue;
        const def = getDef(b.def);
        if (!def) continue;
        const isLit = def.zone === 'residential' || def.zone === 'commercial'
          || def.zone === 'industrial' || def.zone === 'service';
        if (!isLit) continue;
        const { sx, sy } = tileToScreen(x, y);
        const r = 26 + def.tiers * 4;
        const g2 = ctx.createRadialGradient(sx, sy - 18, 2, sx, sy - 18, r);
        g2.addColorStop(0, `rgba(255,215,154,${0.30 * glow})`);
        g2.addColorStop(1, 'rgba(255,215,154,0)');
        ctx.fillStyle = g2;
        ctx.beginPath();
        ctx.arc(sx, sy - 18, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** A soft dark edge focuses attention on the middle of the map. */
  drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      this.viewW / 2, this.viewH / 2, Math.min(this.viewW, this.viewH) * 0.34,
      this.viewW / 2, this.viewH / 2, Math.max(this.viewW, this.viewH) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(8,12,22,0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }
}
