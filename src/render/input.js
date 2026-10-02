/**
 * input.js — pointer, keyboard and camera control.
 *
 * Maps raw DOM events onto game intents (place / bulldoze / select / pan /
 * zoom) and forwards them to the app. It owns no game state: everything it
 * produces is a request the app validates through systems/build.js.
 *
 * Touch is supported as a first-class citizen (single-finger pan, pinch zoom,
 * tap-to-place) even though the design brief treats it as a bonus.
 */

import { inBounds, } from '../core/state.js';

export class Input {
  constructor(canvas, renderer, app) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.app = app;
    this.dragging = false;
    this.dragMoved = false;
    this.panning = false;
    this.lastPointer = { x: 0, y: 0 };
    this.pointers = new Map();
    this.pinchStart = null;

    this._bind();
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('pointerleave', (e) => this.onLeave(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  localPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  onDown(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, this.localPoint(e));

    if (this.pointers.size === 2) {
      // begin pinch
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.renderer.state.camera.tzoom };
      this.panning = false;
      return;
    }

    const p = this.localPoint(e);
    this.lastPointer = p;
    this.dragging = true;
    this.dragMoved = false;
    // right button or space-held = pan; otherwise the active tool
    this.panning = e.button === 2 || e.button === 1 || this.app.tool === 'pan';
    this.paint(p);
  }

  onMove(e) {
    const p = this.localPoint(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);

    if (this.pinchStart && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const next = this.pinchStart.zoom * (d / this.pinchStart.dist);
      this.app.setZoom(next);
      return;
    }

    if (this.panning && this.dragging) {
      const cam = this.renderer.state.camera;
      const dx = (p.x - this.lastPointer.x) / cam.zoom;
      const dy = (p.y - this.lastPointer.y) / cam.zoom;
      cam.tx -= dx; cam.ty -= dy;
      this.renderer.clampCamera();
      this.dragMoved = true;
    } else if (this.dragging) {
      // drag-paint roads and zones
      if (Math.hypot(p.x - this.lastPointer.x, p.y - this.lastPointer.y) > 6) this.dragMoved = true;
      this.paint(p);
    } else {
      this.renderer.hoverTile = this.tileAt(p);
      this.app.onHover(this.renderer.hoverTile);
    }
    this.lastPointer = p;
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.panning = false;
      this.dragMoved = false;
    }
  }

  onLeave() {
    this.renderer.hoverTile = null;
    this.app.onHover(null);
  }

  onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    this.app.setZoom(this.renderer.state.camera.tzoom * factor);
  }

  tileAt(p) {
    const t = this.renderer.screenToTile(p.x, p.y);
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  }

  /** Apply the active tool at a screen point. */
  paint(p) {
    const t = this.tileAt(p);
    if (!inBounds(this.renderer.state, t.x, t.y)) return;
    this.renderer.hoverTile = t;
    this.app.onTileAction(t, { dragging: this.dragging && this.dragMoved });
  }
}
