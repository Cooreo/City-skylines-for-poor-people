/**
 * app.js — the composition root.
 *
 * Creates the game, the renderer, the input controller and every UI panel,
 * wires the event bus between them, and owns the single animation frame loop.
 *
 * This is the only module that knows about both the DOM and the simulation.
 * Everything below it is either pure simulation (importable in Node with no
 * browser) or pure presentation.
 */

import { createGame } from './core/game.js';
import { createBus, EV } from './core/eventbus.js';
import { createRng } from './core/rng.js';
import { TILE_W, TILE_H, createState } from './core/state.js';
import { place, demolish, upgrade, lineTiles, isDraggable } from './systems/build.js';
import { canPlace } from './systems/grid.js';
import { BUILDINGS, getDef } from './data/buildings.js';
import { VICTORY } from './data/progression.js';
import { repayLoan } from './systems/economy.js';
import { load, save, deleteSave } from './core/save.js';

import { Renderer } from './render/renderer.js';
import { renderTerrain, invalidateTerrain } from './render/terrain.js';
import { Agents } from './render/agents.js';
import { Particles } from './render/particles.js';
import { Input } from './render/input.js';

import { money } from './ui/dom.js';
import { TopBar, Palette, Inspector, Tooltip, Toasts, BudgetPanel } from './ui/panels.js';
import { EventCards, Milestones, Victory } from './ui/cards.js';
import { Menu } from './ui/menu.js';

export class App {
  constructor({ canvas, bus = createBus() } = {}) {
    this.canvas = canvas;
    this.bus = bus;
    this.game = createGame({ bus });
    this.rng = createRng(this.game.state.seed ^ 0x9e3779b9);

    this.renderer = new Renderer(canvas, this.game.state, this.game.clock);
    this.particles = new Particles();
    this.agents = new Agents(this.game.state, this.rng);
    this.renderer.agents = this.agents;
    this.renderer.particles = this.particles;
    this.renderer.state._viewW = this.renderer.viewW;
    this.renderer.state._viewH = this.renderer.viewH;
    this.renderer.state._nightGlow = 0;

    this.input = new Input(canvas, this.renderer, this);

    this.ui = {
      top: new TopBar(this),
      palette: new Palette(this),
      inspector: new Inspector(this),
      toasts: new Toasts(this),
      budget: new BudgetPanel(this),
      cards: new EventCards(this),
      milestones: new Milestones(this),
      victory: new Victory(this),
      menu: new Menu(this),
    };
    new Tooltip();

    this.dragStart = null;
    this.autoSaveCounter = 0;
    this._lastFrame = 0;
    this._goalPop = VICTORY.goalPop;
    this._goalHappiness = VICTORY.goalHappiness;
    this.game.state._goalPop = this._goalPop;
    this.game.state._goalHappiness = this._goalHappiness;

    this.bindBus();
    this.bindKeys();
    this.bindResize();
    this.rebuildTerrain();
    this.centreCamera();
    this.refreshUI();

    // Try to resume the autosave, otherwise start fresh.
    const resumed = load(0, this.bus);
    if (resumed) {
      this.adoptState(resumed);
      this.ui.toasts.push({ text: 'Welcome back — autosave restored.', tone: 'info', ttl: 5000 });
    }

    requestAnimationFrame((t) => this.frame(t));
  }

  /* ── wiring ───────────────────────────────────────────────────────────── */

  bindBus() {
    const b = this.bus;
    b.on(EV.TICK, () => this.refreshUI());
    b.on(EV.TOAST, (t) => this.ui.toasts.push(t));
    b.on(EV.UNLOCK, () => this.ui.palette.refresh());
    b.on(EV.SELECTION, () => this.ui.palette.refresh());
    b.on(EV.SPEED, () => this.ui.top.refresh());
    b.on(EV.LOAD, () => { this.rebuildTerrain(); this.agents.reset(); this.particles.reset(); this.refreshUI(); });

    b.on(EV.BUILD, ({ x, y, defId, upgrade: isUpgrade }) => {
      if (!this.game.state.settings.reduceMotion) {
        this.particles.burst(isUpgrade ? 'spark' : 'dust', x, y, isUpgrade ? 12 : 9, 18);
      }
      if (isUpgrade) this.particles.burst('coin', x, y, 6, 12);
      invalidateTerrain();
    });
    b.on(EV.DEMOLISH, ({ x, y }) => {
      this.particles.burst('dust', x, y, 14, 22);
      invalidateTerrain();
    });
    b.on(EV.SAVE, ({ slot, bytes }) => {
      this.ui.toasts.push({ text: `Saved to slot ${slot} (${(bytes / 1024).toFixed(1)} kB).`, tone: 'ok', ttl: 3000 });
    });
  }

  bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target.matches('input, textarea')) return;
      const s = this.game.state;
      const k = e.key.toLowerCase();

      // hotkeys come straight from the build catalogue, so data and keys never drift
      const hot = Object.entries(BUILDINGS).find(([, d]) => d.hotkey && d.hotkey.toLowerCase() === k);
      if (hot) { this.selectTool(hot[0]); e.preventDefault(); return; }

      if (k === ' ') { this.setSpeed(s.speed === 0 ? 1 : 0); e.preventDefault(); }
      else if (k === '+' || k === '=') this.setSpeed(Math.min(3, s.speed + 1));
      else if (k === '-' || k === '_') this.setSpeed(Math.max(0, s.speed - 1));
      else if (k === 'escape') { this.ui.menu.close(); this.ui.inspector.hide(); this.selectTool('inspect'); }
      else if (k === 'h') this.ui.menu.open('help');
      else if (k === 'g') s.settings.showGrid = !s.settings.showGrid;
      else if (k === 'arrowleft' || k === 'a') this.pan(-60, 0);
      else if (k === 'arrowright' || k === 'd') this.pan(60, 0);
      else if (k === 'arrowup' || k === 'w') this.pan(0, -60);
      else if (k === 'arrowdown' || k === 's') this.pan(0, 60);
    });
  }

  bindResize() {
    const onResize = () => {
      this.renderer.resize();
      this.renderer.state._viewW = this.renderer.viewW;
      this.renderer.state._viewH = this.renderer.viewH;
    };
    window.addEventListener('resize', onResize);
    onResize();
  }

  /* ── camera ───────────────────────────────────────────────────────────── */

  /** Frame the guaranteed-clear opening plot, which is where the player starts. */
  centreCamera() {
    const s = this.game.state;
    const cam = s.camera;
    const c = s.center || { x: s.starter.x + (s.starter.size >> 1), y: s.starter.y + (s.starter.size >> 1) };
    cam.tx = (c.x - c.y) * (TILE_W / 2);
    cam.ty = (c.x + c.y) * (TILE_H / 2);
    cam.x = cam.tx; cam.y = cam.ty;
    cam.tzoom = 1; cam.zoom = 1;
    this.renderer.clampCamera();
  }

  pan(dx, dy) {
    const cam = this.game.state.camera;
    cam.tx += dx; cam.ty += dy;
    this.renderer.clampCamera();
  }

  setZoom(z) {
    const cam = this.game.state.camera;
    cam.tzoom = Math.max(0.55, Math.min(2.2, z));
    this.renderer.clampCamera();
  }

  /* ── tools ────────────────────────────────────────────────────────────── */

  selectTool(id) {
    if (!this.game.state.unlocked.includes(id)) {
      const def = getDef(id);
      this.ui.toasts.push({
        text: `${def.label} unlocks at ${def.unlockPop} citizens.`,
        tone: 'warn', ttl: 3500,
      });
      return;
    }
    this.game.state.tool = id;
    this.bus.emit(EV.TOOL, { toolId: id });
    this.ui.palette.refresh();
  }

  onHover(tile) {
    const tool = this.game.state.tool;
    if (!tile || tool === 'inspect' || tool === 'pan') { this.renderer.ghost = null; return; }
    const check = canPlace(this.game.state, tool, tile.x, tile.y);
    this.renderer.ghost = { defId: tool, x: tile.x, y: tile.y, ok: check.ok, reason: check.reason };
  }

  /** A click or drag on the map. */
  onTileAction(tile, { dragging } = {}) {
    const s = this.game.state;
    const tool = s.tool;

    if (tool === 'inspect' || tool === 'pan') {
      s.selection = { x: tile.x, y: tile.y };
      this.ui.inspector.show(tile.x, tile.y);
      return;
    }

    if (tool === 'bulldoze') {
      const r = demolish(s, tile.x, tile.y);
      if (!r.ok) this.ui.toasts.push({ text: r.reason, tone: 'warn', ttl: 2500 });
      this.refreshUI();
      return;
    }

    // drag-paint roads and zones as a line
    if (dragging && isDraggable(tool) && this.dragStart) {
      for (const t of lineTiles(this.dragStart.x, this.dragStart.y, tile.x, tile.y)) {
        const r = place(s, tool, t.x, t.y);
        if (!r.ok && r.reason !== 'Tile is occupied') break;
      }
      this.refreshUI();
      return;
    }

    this.dragStart = { x: tile.x, y: tile.y };
    const r = place(s, tool, tile.x, tile.y);
    if (!r.ok) this.ui.toasts.push({ text: r.reason, tone: 'warn', ttl: 2500 });
    this.refreshUI();
  }

  upgradeAt(x, y) {
    const r = upgrade(this.game.state, x, y);
    if (!r.ok) this.ui.toasts.push({ text: r.reason, tone: 'warn', ttl: 3000 });
    else this.ui.toasts.push({ text: `Upgraded for ${money(r.cost)}.`, tone: 'ok', ttl: 3000 });
    this.ui.inspector.show(x, y);
    this.refreshUI();
  }

  bulldozeAt(x, y) {
    const r = demolish(this.game.state, x, y);
    if (!r.ok) this.ui.toasts.push({ text: r.reason, tone: 'warn', ttl: 3000 });
    this.ui.inspector.hide();
    this.refreshUI();
  }

  setTaxLevel(id) {
    this.game.setTaxLevel(id);
    this.refreshUI();
  }

  toggleCoverage(key) {
    const s = this.game.state;
    s.settings.showCoverage = s.settings.showCoverage === key ? null : key;
    this.renderer.showCoverage = s.settings.showCoverage;
    this.ui.palette.refresh();
  }

  toggleBudget() { this.ui.budget.toggle(); }
  toggleHelp() { this.ui.menu.open('help'); }
  toggleMenu() { this.ui.menu.open('menu'); }

  repayLoan() {
    const ok = repayLoan(this.game.state, 0);
    this.ui.toasts.push({
      text: ok ? 'Loan repaid.' : 'Not enough cash to repay yet.',
      tone: ok ? 'ok' : 'warn', ttl: 3000,
    });
    this.ui.budget.refresh();
    this.refreshUI();
  }

  setSpeed(n) { this.game.setSpeed(n); this.ui.top.refresh(); }

  /* ── save / load ──────────────────────────────────────────────────────── */

  save(slot) { save(this.game.state, slot); }

  load(slot) {
    const state = load(slot, this.bus);
    if (!state) {
      this.ui.toasts.push({ text: 'That slot is empty.', tone: 'warn', ttl: 3000 });
      return;
    }
    this.adoptState(state);
    this.ui.menu.close();
    this.ui.toasts.push({ text: `Loaded slot ${slot}.`, tone: 'ok', ttl: 3000 });
  }

  /** Swap in a freshly loaded state, keeping the renderer wired up. */
  adoptState(state) {
    const bus = this.bus;
    this.game = createGame({ state, bus });
    this.game.state.bus = bus;
    this.renderer.state = this.game.state;
    this.renderer.clock = this.game.clock;
    this.renderer.state._viewW = this.renderer.viewW;
    this.renderer.state._viewH = this.renderer.viewH;
    this.renderer.state._goalPop = this._goalPop;
    this.renderer.state._goalHappiness = this._goalHappiness;
    this.agents = new Agents(this.game.state, this.rng);
    this.renderer.agents = this.agents;
    this.agents.reset();
    this.particles.reset();
    this.rebuildTerrain();
    this.centreCamera();
    this.refreshUI();
  }

  newGame() {
    deleteSave(0);
    this.adoptState(createState({ seed: (Date.now() & 0xffff) | 1 }));
    this.ui.menu.close();
    this.ui.toasts.push({ text: 'A fresh island. Good luck.', tone: 'ok', ttl: 4000 });
  }

  /* ── frame loop ───────────────────────────────────────────────────────── */

  rebuildTerrain() {
    const layer = renderTerrain(this.game.state);
    this.game.state._terrainLayer = layer;
  }

  refreshUI() {
    this.ui.top.refresh();
    this.ui.palette.refresh();
    if (!this.ui.inspector.root.classList.contains('hidden') && this.game.state.selection) {
      this.ui.inspector.show(this.game.state.selection.x, this.game.state.selection.y);
    }
  }

  frame(now) {
    const dt = Math.min(0.1, (now - this._lastFrame) / 1000 || 0.016);
    this._lastFrame = now;

    // simulation
    this.game.update(dt);
    if (this.game.state.settings.autoSave && this.game.state.tick > 0 && this.game.state.tick % 20 === 0) {
      if (this.autoSaveCounter !== this.game.state.tick) {
        this.autoSaveCounter = this.game.state.tick;
        save(this.game.state, 0);
      }
    }

    // night glow level for headlights and windows
    const glow = nightGlowOf(this.game.clock.clock);
    this.game.state._nightGlow = glow;

    // world
    this.agents.update(dt);
    this.particles.update(dt);
    this.renderer.updateCamera(dt);
    this.renderer.render(dt);

    requestAnimationFrame((t) => this.frame(t));
  }
}

function nightGlowOf(clock) {
  const l = 0.5 + 0.5 * Math.cos((clock - 0.5) * Math.PI * 2);
  return Math.max(0, Math.min(1, (0.72 - Math.pow(l, 0.72)) / 0.5));
}
