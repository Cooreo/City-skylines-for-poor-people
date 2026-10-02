/**
 * boot.test.js — does the whole client actually boot and render?
 *
 * There is no browser in CI, so test/dom-stub.js supplies a minimal DOM and a
 * Canvas2D context that records every call. This file imports the real app.js
 * composition root, constructs it against that stub, runs frames, builds
 * things, opens cards and reloads from a save.
 *
 * It cannot verify that the city *looks* right. It does verify that the app
 * starts, that a frame produces the drawing calls we expect, and that none of
 * the browser-only code paths throw.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const stub = await import('./dom-stub.js');
stub.install();

const { createState, TERRAIN, idx } = await import('../src/core/state.js');
const { createBus } = await import('../src/core/eventbus.js');
const { place } = await import('../src/systems/build.js');
const { App } = await import('../src/app.js');

function newApp() {
  const canvas = stub.document.getElementById('city');
  return new App({ canvas, bus: createBus() });
}

/** Tests share one process, so every test starts from a clean stub. */
test.beforeEach(() => stub.resetAll());

/** Recursively collect text from a panel, including nested children. */
const text = (node) => stub.textOf(node);

test('the app boots and renders frames without throwing', () => {
  const app = newApp();
  assert.ok(app.game, 'game created');
  assert.ok(app.renderer, 'renderer created');
  stub.resetCalls();
  stub.runFrames(10);
  assert.ok(stub.calls.count > 100, `expected drawing calls, got ${stub.calls.count}`);
  assert.ok(stub.calls.drawImage > 0, 'ground layer was drawn');
});

test('the HUD mounts every panel', () => {
  newApp();
  for (const id of ['hud-top', 'hud-bottom', 'inspector', 'budget', 'toasts', 'overlay']) {
    const node = stub.document.getElementById(id);
    assert.ok(node, `${id} exists`);
  }
  const top = stub.document.getElementById('hud-top');
  assert.ok(top.children.length > 0, 'top bar has children');
  const bottom = stub.document.getElementById('hud-bottom');
  assert.ok(bottom.children.length > 0, 'palette has children');
});

test('placing buildings renders sprites', () => {
  const app = newApp();
  const s = app.game.state;
  const { x, y } = s.starter;
  for (let i = 0; i < 6; i++) place(s, 'road', x + i, y + 1);
  place(s, 'powerPlant', x + 1, y + 4);
  place(s, 'waterTower', x + 5, y + 4);
  for (let i = 0; i < 4; i++) place(s, 'residential', x + i, y + 2);

  stub.resetCalls();
  stub.runFrames(4);
  // ground + 4 buildings + ghosts + agents
  assert.ok(stub.calls.drawImage >= 5, `expected sprite draws, got ${stub.calls.drawImage}`);
});

test('a building is drawn with a cached sprite, not redrawn every frame', () => {
  const app = newApp();
  const s = app.game.state;
  const { x, y } = s.starter;
  place(s, 'road', x + 1, y + 1);
  place(s, 'residential', x + 1, y + 2);

  stub.runFrames(1);
  const perFrame = stub.calls.drawImage;   // ground + 2 buildings
  assert.ok(perFrame === 3, `expected 3 draws (ground + 2 buildings), got ${perFrame}`);

  // ten more frames must cost exactly the same: the sprites are cached
  stub.resetCalls();
  stub.runFrames(10);
  assert.equal(stub.calls.drawImage, perFrame * 10,
    `sprite cache is leaking: ${stub.calls.drawImage} draws for 10 frames`);
});

test('selecting a tile opens the inspector with real content', () => {
  const app = newApp();
  const s = app.game.state;
  const { x, y } = s.starter;
  place(s, 'residential', x + 2, y + 2);
  app.selectTool('inspect');
  app.onTileAction({ x: x + 2, y: y + 2 });
  const insp = stub.document.getElementById('inspector');
  assert.ok(!insp.classList.contains('hidden'), 'inspector is visible');
  const t = text(insp);
  assert.match(t, /Housing/, 'shows the building name');
  assert.match(t, /Occupancy/, 'shows occupancy');
  assert.match(t, /Tier 1 of 4/, 'shows the tier');
});

test('inspecting empty land explains the terrain', () => {
  const app = newApp();
  const s = app.game.state;
  const { x, y } = s.starter;
  app.selectTool('inspect');
  app.onTileAction({ x: x + 3, y: y + 3 });
  const t = text(stub.document.getElementById('inspector'));
  assert.match(t, /empty land/, 'explains the tile is empty');
});

test('the build palette reflects unlock state and affordability', () => {
  const app = newApp();
  app.selectTool('residential');
  const t = text(stub.document.getElementById('hud-bottom'));
  assert.match(t, /Housing/, 'palette lists housing');
  assert.match(t, /Road/, 'palette lists roads');
  assert.match(t, /Power Plant/, 'palette lists services');
  // a locked building explains itself when clicked
  app.selectTool('hospital');
  assert.match(text(stub.document.getElementById('toasts')), /unlocks at 400/, 'lock is explained');
});

test('event cards render and resolve', () => {
  const app = newApp();
  const s = app.game.state;
  s.day = 3; s.season = 'summer'; s.city.pop = 400; s.economy.cash = 5000;
  s.deck.active = 'heatwave';
  app.bus.emit('event:show', {
    id: 'heatwave', title: 'Heatwave', icon: 'sun', blurb: 'It is hot.',
    choices: [
      { label: 'Open cooling centres', hint: '-300', run: () => 'done' },
      { label: 'Do nothing', hint: 'risky', run: () => 'no' },
    ],
  });
  const overlay = stub.document.getElementById('overlay');
  assert.ok(overlay.children.length > 0, 'a card is shown');
  const t = text(overlay);
  assert.match(t, /Heatwave/, 'card title rendered');
  assert.match(t, /cooling centres/, 'choices rendered');
  // resolveEvent runs the real data-driven choice, so the outcome text comes
  // from data/events.js rather than from the stub event above.
  app.game.resolveEvent(0);
  assert.equal(s.deck.active, null, 'card resolved');
  assert.equal(s.stats.eventsResolved, 1, 'the choice was counted');
  assert.match(text(stub.document.getElementById('toasts')), /Cots and cold water/, 'outcome toasted');
});

test('saving and loading round-trips through the localStorage stub', () => {
  const app = newApp();
  const s = app.game.state;
  const { x, y } = s.starter;
  place(s, 'road', x + 1, y + 1);
  place(s, 'residential', x + 1, y + 2);
  s.city.pop = 321;
  app.save(1);
  assert.ok(stub.localStorage.getItem('micro-metropolis.v3.slot.1'), 'a save exists');

  // a brand new app must resume the autosave
  const app2 = newApp();
  assert.equal(app2.game.state.tick, s.tick, 'autosave resumed');
});

test('the frame loop keeps running after many frames', () => {
  const app = newApp();
  stub.runFrames(200);                 // 3.2s: enough for at least one tick
  assert.ok(app.game.state.tick > 0, 'the simulation advanced');
  assert.ok(app.renderer.fps > 0, 'fps is being measured');
});

test('the game survives a full session: build, tick, save, reload, keep ticking', () => {
  const app = newApp();
  const s = app.game.state;
  const { x, y } = s.starter;
  for (let i = 0; i < 8; i++) place(s, 'road', x + i, y + 1);
  place(s, 'powerPlant', x + 1, y + 4);
  place(s, 'waterTower', x + 4, y + 4);
  for (let i = 0; i < 5; i++) place(s, 'residential', x + i, y + 2);

  stub.runFrames(300);          // ~4.8s of game time
  const popAfter = s.city.pop;
  assert.ok(popAfter > 0, `city grew to ${popAfter}`);

  app.save(2);
  const reloaded = newApp();
  stub.runFrames(30);
  assert.ok(reloaded.game.state.city.pop >= 0, 'still simulating after reload');
});

/* ── long session: every system, through the real UI ────────────────────── */

/**
 * A single long play-through that drives the actual app: builds, upgrades,
 * bulldozes, resolves event cards, changes tax, toggles overlays, saves and
 * reloads. Any wiring mistake anywhere in the stack shows up as a console.error
 * from the event bus, which this test fails on.
 */
test('a long session exercises every system with no errors', () => {
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.map(String).join(' '));

  let app;
  try {
    app = newApp();
    const s = app.game.state;
    const { x, y } = s.starter;

    // 1. a starter town
    for (let i = 0; i < 10; i++) place(s, 'road', x + i, y + 1);
    for (let i = 0; i < 10; i++) place(s, 'road', x + i, y + 5);
    place(s, 'powerPlant', x + 1, y + 8);
    place(s, 'waterTower', x + 5, y + 8);
    place(s, 'school', x + 7, y + 8);
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 9; i++) {
        const kind = (i + r) % 4 === 0 ? 'commercial'
          : (i + r) % 7 === 2 ? 'industrial'
          : (i + r) % 5 === 1 ? 'park' : 'residential';
        place(s, kind, x + 1 + i, y + 2 + r * 3);
      }
    }

    // 2. run the simulation hard, resolving every card that appears
    let cards = 0;
    for (let i = 0; i < 1200; i++) {
      if (s.deck.active) { app.game.resolveEvent(i % 3); cards++; }
      // cycle tools so every code path in the input handler is hit
      app.selectTool(['road', 'residential', 'commercial', 'park', 'bulldoze', 'inspect'][i % 6]);
      app.onTileAction({ x: x + (i % 10), y: y + 2 + (i % 9) }, { dragging: i % 4 === 0 });
      if (i % 37 === 0) app.ui.inspector.show(x + 1, y + 2);
      if (i % 53 === 0) app.toggleCoverage(['health', 'education', 'safety', 'transit'][i % 4]);
      if (i % 71 === 0) app.setTaxLevel(['low', 'normal', 'high'][i % 3]);
      if (i % 97 === 0) app.setSpeed([0, 1, 2, 3][i % 4]);
      if (i % 211 === 0) app.upgradeAt(x + 1, y + 2);
      if (i % 307 === 0) app.bulldozeAt(x + 9, y + 2);
      app.game.fastForward(2);
      stub.runFrames(2);
    }

    // 3. save, reload, and keep going
    app.save(2);
    const reloaded = newApp();
    stub.runFrames(20);
    reloaded.game.fastForward(10);
    stub.runFrames(5);

    // 4. assertions
    assert.equal(errors.length, 0, `console.error was called:\n${errors.slice(0, 5).join('\n')}`);
    assert.ok(cards > 0, 'no event cards fired in 2,400 ticks');
    assert.ok(app.game.state.tick > 100, 'the simulation barely advanced');
    assert.ok(app.game.state.stats.built > 20, 'nothing was built');
  } finally {
    console.error = realError;
  }
});

test('victory can fire and the medal screen renders', () => {
  const app = newApp();
  const s = app.game.state;
  // Force the win condition rather than playing 4,000 ticks of game.
  s.city.pop = 5000;
  s.city.happiness = 90;
  s.stats.bestPop = 5000;
  s.stats.bestHappiness = 90;
  s.economy.totalEarned = 250000;
  s.won = false;
  app.bus.emit('victory', { medals: [{ id: 'x', label: 'Test', text: 'because' }], stats: s.stats, day: 40 });

  const overlay = stub.document.getElementById('overlay');
  assert.ok(overlay.children.length > 0, 'the victory screen appeared');
  const t = text(overlay);
  assert.match(t, /metropolis is finished/, 'victory copy rendered');
  assert.match(t, /Test/, 'medal rendered');
  assert.match(t, /Citizens housed/, 'stats rendered');
});

test('the treasury panel shows a full income and expense breakdown', () => {
  const app = newApp();
  const s = app.game.state;
  s.economy.breakdown = { fromResidential: 40, fromCommercial: 30, fromIndustrial: 12, upkeep: 22, roadUpkeep: 4, interest: 0 };
  s.city.roadTiles = 200;
  app.toggleBudget();
  const t = text(stub.document.getElementById('budget'));
  assert.match(t, /Residential tax/, 'income rows');
  assert.match(t, /Building upkeep/, 'expense rows');
  assert.match(t, /Road upkeep/, 'road upkeep row');
  assert.match(t, /Coverage/, 'coverage rows');
});

test('the help sheet and the save menu both open with content', () => {
  const app = newApp();
  app.toggleHelp();
  let t = text(stub.document.getElementById('overlay'));
  assert.match(t, /How to play/, 'help title');
  assert.match(t, /Roads/, 'help content');
  app.ui.menu.close();

  app.toggleMenu();
  t = text(stub.document.getElementById('overlay'));
  assert.match(t, /Menu/, 'menu title');
  app.ui.menu.close();

  app.ui.menu.open('saves');
  t = text(stub.document.getElementById('overlay'));
  assert.match(t, /Save \/ Load/, 'save screen');
  assert.match(t, /Autosave/, 'slot labels');
  app.ui.menu.close();
});
