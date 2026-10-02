/**
 * particles.js — construction dust, cash pops, hearts and smoke.
 *
 * A single fixed-size pool of structs, updated in one pass with no allocation
 * after construction. Particles are pure decoration: they never touch game
 * state, so they can be disabled entirely (reduceMotion) with no consequence
 * beyond looking calmer.
 */

import { tileToScreen } from './terrain.js';
import { PALETTE } from '../data/palette.js';

const POOL = 320;

const KINDS = {
  dust: { gravity: 26, life: 0.85, size: [1.5, 3.4], drag: 2.4, color: PALETTE.dust },
  spark: { gravity: -12, life: 0.6, size: [1, 2.2], drag: 1.6, color: PALETTE.spark },
  coin: { gravity: -34, life: 1.1, size: [2, 3.4], drag: 0.6, color: PALETTE.coin },
  heart: { gravity: -22, life: 1.3, size: [2, 3.6], drag: 0.9, color: PALETTE.heart },
  smoke: { gravity: -18, life: 1.8, size: [2.4, 5], drag: 0.9, color: PALETTE.smoke },
  leaf: { gravity: 10, life: 2.2, size: [1.4, 2.6], drag: 1.2, color: PALETTE.leaf },
};

export class Particles {
  constructor() {
    this.pool = [];
    for (let i = 0; i < POOL; i++) {
      this.pool.push({ alive: false, kind: 'dust', x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, size: 2, spin: 0, rot: 0 });
    }
    this.count = 0;
    this.enabled = true;
  }

  /** Spawn `n` particles of `kind` at a tile position. */
  burst(kind, x, y, n = 8, spread = 14) {
    if (!this.enabled) return;
    const spec = KINDS[kind];
    if (!spec) return;
    for (let i = 0; i < n; i++) {
      const p = this.pool.find((q) => !q.alive);
      if (!p) return;
      const { sx, sy } = tileToScreen(x, y);
      p.alive = true;
      p.kind = kind;
      p.x = sx + (Math.random() - 0.5) * spread;
      p.y = sy + (Math.random() - 0.5) * (spread * 0.5) - 6;
      p.vx = (Math.random() - 0.5) * 26;
      p.vy = -Math.random() * 30 - 6;
      p.age = 0;
      p.life = spec.life * (0.7 + Math.random() * 0.6);
      p.size = spec.size[0] + Math.random() * (spec.size[1] - spec.size[0]);
      p.spin = (Math.random() - 0.5) * 5;
      p.rot = Math.random() * Math.PI;
      this.count++;
    }
  }

  update(dt) {
    let alive = 0;
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.age += dt;
      if (p.age >= p.life) { p.alive = false; continue; }
      const spec = KINDS[p.kind];
      p.vy += spec.gravity * dt;
      const drag = 1 - Math.min(0.9, spec.drag * dt);
      p.vx *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      alive++;
    }
    this.count = alive;
  }

  draw(ctx) {
    if (!this.enabled) return;
    for (const p of this.pool) {
      if (!p.alive) continue;
      const t = p.age / p.life;
      const spec = KINDS[p.kind];
      ctx.save();
      ctx.globalAlpha = 1 - t * t;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = spec.color;
      const s = p.size * (p.kind === 'smoke' ? 1 + t * 1.6 : 1);
      if (p.kind === 'heart') {
        ctx.beginPath();
        ctx.moveTo(0, s * 0.6);
        ctx.bezierCurveTo(s, -s * 0.4, s * 0.4, -s, 0, -s * 0.5);
        ctx.bezierCurveTo(-s * 0.4, -s, -s, -s * 0.4, 0, s * 0.6);
        ctx.fill();
      } else if (p.kind === 'coin') {
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.7, s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(-s * 0.2, -s * 0.5, s * 0.4, s);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, s, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  reset() {
    for (const p of this.pool) p.alive = false;
    this.count = 0;
  }
}
