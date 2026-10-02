/**
 * panels.js — the HUD: top bar, build palette, inspector, budget, toasts.
 *
 * Every panel is a small class with a `refresh()`. The app calls `refresh()`
 * in response to bus events; nothing polls on a timer, so an idle game does
 * zero DOM work.
 */

import { $, el, fmt, money, signed } from './dom.js';
import { ZONE_THEME } from '../data/palette.js';
import { BUILDINGS, BUILD_ORDER, getDef, TIERS } from '../data/buildings.js';
import { TAX_LEVELS, VICTORY, nextMilestone } from '../data/progression.js';
import { EV } from '../core/eventbus.js';
import { runwayTicks, totalDebt } from '../systems/economy.js';
import { describe as describeModifiers } from '../systems/modifiers.js';

/* ── top bar ────────────────────────────────────────────────────────────── */

export class TopBar {
  constructor(app) {
    this.app = app;
    this.root = $('#hud-top');
    this.build();
  }

  build() {
    this.root.append(
      el('div', { class: 'brand' }, [
        el('span', { class: 'brand-mark' }),
        el('span', { class: 'brand-text', text: 'Micro Metropolis' }),
      ]),
      el('div', { class: 'stats' }, [
        (this.cash = el('button', {
          class: 'stat stat-cash', title: 'Treasury — click for the budget panel',
          onclick: () => this.app.toggleBudget(),
        }, [el('span', { class: 'stat-ico', text: '\u00a4' }), el('span', { class: 'stat-val', text: '0' })])),
        (this.pop = el('div', { class: 'stat stat-pop', title: 'Population' }, [
          el('span', { class: 'stat-ico', text: '\u25cf' }),
          el('span', { class: 'stat-val', text: '0' }),
          el('span', { class: 'stat-sub', text: '' }),
        ])),
        (this.happy = el('div', { class: 'stat stat-happy', title: 'City-wide happiness' }, [
          el('span', { class: 'stat-ico', text: '\u263a' }),
          el('span', { class: 'stat-val', text: '0' }),
          el('span', { class: 'meter' }, [(this.happyFill = el('i'))]),
        ])),
        (this.date = el('div', { class: 'stat stat-date', title: 'In-game date and season' }, [
          el('span', { class: 'stat-ico', text: '\u25ce' }),
          el('span', { class: 'stat-val', text: 'Day 1' }),
          el('span', { class: 'stat-sub', text: 'spring' }),
        ])),
      ]),
      el('div', { class: 'topright' }, [
        (this.speed = el('div', { class: 'speed' }, [
          el('button', { class: 'spd', 'data-speed': '0', text: '\u23f8', title: 'Pause', onclick: () => this.app.setSpeed(0) }),
          el('button', { class: 'spd', 'data-speed': '1', text: '\u25b6', title: 'Normal speed', onclick: () => this.app.setSpeed(1) }),
          el('button', { class: 'spd', 'data-speed': '2', text: '\u25b6\u25b6', title: 'Fast', onclick: () => this.app.setSpeed(2) }),
          el('button', { class: 'spd', 'data-speed': '3', text: '\u23e9', title: 'Fastest', onclick: () => this.app.setSpeed(3) }),
        ])),
        el('button', { class: 'iconbtn', text: '?', title: 'Help (H)', onclick: () => this.app.toggleHelp() }),
        el('button', { class: 'iconbtn', text: '\u2261', title: 'Menu: save, load, settings', onclick: () => this.app.toggleMenu() }),
      ])
    );
  }

  refresh() {
    const s = this.app.game.state;
    const eco = s.economy;
    const city = s.city;
    this.cash.querySelector('.stat-val').textContent = money(eco.cash);
    this.cash.classList.toggle('is-negative', eco.cash < 0);
    this.cash.classList.toggle('is-debt', totalDebt(s) > 0);

    this.pop.querySelector('.stat-val').textContent = fmt(city.pop);
    this.pop.querySelector('.stat-sub').textContent = `of ${fmt(VICTORY.goalPop)}`;

    const h = Math.round(city.happiness);
    this.happy.querySelector('.stat-val').textContent = String(h);
    this.happyFill.style.width = `${h}%`;
    this.happy.className = `stat stat-happy ${h >= 70 ? 'good' : h >= 45 ? 'ok' : 'bad'}`;

    this.date.querySelector('.stat-val').textContent = `Day ${s.day}`;
    this.date.querySelector('.stat-sub').textContent = s.season;

    for (const b of this.speed.querySelectorAll('.spd')) {
      b.classList.toggle('on', Number(b.dataset.speed) === s.speed);
    }
  }
}

/* ── build palette ──────────────────────────────────────────────────────── */

export class Palette {
  constructor(app) {
    this.app = app;
    this.root = $('#hud-bottom');
    this.buttons = new Map();
    this.build();
  }

  build() {
    const tools = el('div', { class: 'pal-group pal-tools' });
    const zones = el('div', { class: 'pal-group pal-zones' });
    const services = el('div', { class: 'pal-group pal-services' });

    for (const id of BUILD_ORDER) {
      const def = BUILDINGS[id];
      if (!def) continue;
      const theme = ZONE_THEME[def.zone] || ZONE_THEME.tool;
      const btn = el('button', {
        class: 'palbtn',
        'data-id': id,
        style: { '--c': theme.main, '--cd': theme.dark },
        title: '',
        onclick: () => this.app.selectTool(id),
      }, [
        el('span', { class: 'palbtn-ico' }),
        el('span', { class: 'palbtn-label', text: def.label }),
        def.cost > 0 ? el('span', { class: 'palbtn-cost', text: money(def.cost) }) : null,
      ]);
      this.buttons.set(id, btn);
      const host = def.zone === 'tool' ? tools : def.zone === 'service' ? services : zones;
      host.append(btn);
    }

    this.root.append(
      el('div', { class: 'pal-row' }, [
        el('div', { class: 'pal-label', text: 'Build' }),
        tools,
        el('div', { class: 'pal-sep' }),
        zones,
        el('div', { class: 'pal-sep' }),
        services,
      ]),
      el('div', { class: 'pal-row pal-row-2' }, [
        el('div', { class: 'taxbox' }, [
          el('span', { class: 'taxbox-label', text: 'Tax' }),
          ...TAX_LEVELS.map((t) => el('button', {
            class: 'taxbtn', 'data-tax': t.id, text: t.label,
            title: `${t.desc} — x${t.rate.toFixed(2)} revenue, ${t.mood >= 0 ? '+' : ''}${t.mood} mood`,
            onclick: () => this.app.setTaxLevel(t.id),
          })),
        ]),
        el('div', { class: 'covbox' }, [
          el('span', { class: 'covbox-label', text: 'Coverage' }),
          ...['health', 'education', 'safety', 'transit'].map((k) => el('button', {
            class: 'covbtn', 'data-cov': k, text: k[0].toUpperCase() + k.slice(1, 4),
            title: `Show ${k} coverage`,
            onclick: () => this.app.toggleCoverage(k),
          })),
          el('button', { class: 'covbtn', 'data-cov': 'none', text: 'Off', title: 'Hide overlays', onclick: () => this.app.toggleCoverage(null) }),
        ]),
        el('div', { class: 'demandbox' }, [
          el('span', { class: 'demandbox-label', text: 'Demand' }),
          el('span', { class: 'dem', 'data-dem': 'residential', title: 'Residential demand' }),
          el('span', { class: 'dem', 'data-dem': 'commercial', title: 'Commercial demand' }),
          el('span', { class: 'dem', 'data-dem': 'industrial', title: 'Industrial demand' }),
        ]),
      ])
    );
  }

  refresh() {
    const s = this.app.game.state;
    const next = nextMilestone(s.city.pop);
    for (const [id, btn] of this.buttons) {
      const def = BUILDINGS[id];
      const unlocked = s.unlocked.includes(id);
      const affordable = s.economy.cash >= def.cost;
      btn.classList.toggle('locked', !unlocked);
      btn.classList.toggle('unaffordable', unlocked && !affordable);
      btn.classList.toggle('active', s.tool === id);
      btn.title = unlocked
        ? `${def.label} — ${money(def.cost)}${def.upkeep ? `, ${money(def.upkeep)}/tick` : ''}\n${def.desc}${def.hotkey ? `\nHotkey: ${def.hotkey}` : ''}`
        : `Locked — reach ${fmt(def.unlockPop)} citizens${next ? ` (${fmt(next.pop - s.city.pop)} to go)` : ''}`;
    }
    for (const b of this.root.querySelectorAll('.taxbtn')) {
      b.classList.toggle('on', b.dataset.tax === s.economy.taxLevel);
    }
    for (const b of this.root.querySelectorAll('.covbtn')) {
      const on = (b.dataset.cov === 'none' && !s.settings.showCoverage)
        || b.dataset.cov === s.settings.showCoverage;
      b.classList.toggle('on', on);
    }
    for (const d of this.root.querySelectorAll('.dem')) {
      const v = s.city.demand[d.dataset.dem] || 0;
      d.className = `dem ${v > 0.62 ? 'high' : v > 0.38 ? 'mid' : 'low'}`;
      d.title = `${d.dataset.dem}: ${Math.round(v * 100)}% demand`;
    }
  }
}

/* ── inspector ──────────────────────────────────────────────────────────── */

export class Inspector {
  constructor(app) {
    this.app = app;
    this.root = $('#inspector');
    this.root.classList.add('hidden');
  }

  show(x, y) {
    const s = this.app.game.state;
    const b = s.grid.buildings[y * s.grid.w + x];
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');

    if (!b) { this.root.append(...this.terrainPanel(x, y)); return; }

    const def = getDef(b.def);
    const theme = ZONE_THEME[def.zone] || ZONE_THEME.tool;
    const rows = [];
    const push = (label, value, cls = '') => el('div', { class: `irow ${cls}` }, [
      el('span', { class: 'ik', text: label }), el('span', { class: 'iv', text: value }),
    ]);

    rows.push(el('div', { class: 'ihead', style: { '--c': theme.main } }, [
      el('span', { class: 'iswatch' }),
      el('div', {}, [
        el('div', { class: 'ititle', text: def.label }),
        el('div', { class: 'isub', text: `Tier ${b.tier} of ${def.tiers} · tile ${x},${y}` }),
      ]),
    ]));

    const zoned = def.zone === 'residential' || def.zone === 'commercial' || def.zone === 'industrial';
    if (zoned) {
      const cap = (def.housing || def.jobs) * TIERS.CAPACITY[b.tier - 1];
      const occ = Math.round((b.occ || 0) * 100);
      rows.push(el('div', { class: 'imeter' }, [
        el('div', { class: 'imeter-head' }, [
          el('span', { text: def.housing ? 'Occupancy' : 'Activity' }),
          el('b', { text: `${occ}%` }),
        ]),
        el('div', { class: 'ibar' }, [el('i', { style: { width: `${occ}%` } })]),
        el('div', { class: 'inote', text: `${fmt(cap * (b.occ || 0))} ${def.housing ? 'residents' : 'jobs'} of ${fmt(cap)}` }),
      ]));
      rows.push(push('Road access', this.hasRoad(x, y) ? 'Yes' : 'No', this.hasRoad(x, y) ? 'good' : 'bad'));
      rows.push(push('Power', b.powered ? 'Connected' : 'Rationed', b.powered ? 'good' : 'bad'));
      rows.push(push('Water', b.watered ? 'Connected' : 'Rationed', b.watered ? 'good' : 'bad'));
      rows.push(this.svcRow(b));
    } else if (def.service) {
      rows.push(push('Provides', def.service.key));
      if (def.service.radius && def.service.radius < 90) rows.push(push('Radius', `${def.service.radius} tiles`));
      rows.push(push('Capacity', fmt(def.service.capacity * TIERS.CAPACITY[b.tier - 1])));
      rows.push(this.svcRow(b));
    } else if (def.radius) {
      rows.push(push('Mood radius', `${def.radius} tiles`));
      rows.push(push('Mood bonus', `+${def.mood}`));
    } else if (def.zone === 'road') {
      rows.push(push('Lanes', def.avenue ? '3' : '1'));
      rows.push(el('div', { class: 'inote', text: 'Roads connect your city. Buildings must sit within one tile of one.' }));
    }

    if (b.anchor && b.tier < def.tiers) {
      const cost = Math.round(def.cost * TIERS.UPGRADE_COST[b.tier - 1]);
      rows.push(el('button', {
        class: 'iup', text: `Upgrade to tier ${b.tier + 1} — ${money(cost)}`,
        onclick: () => this.app.upgradeAt(x, y),
      }));
    } else if (b.tier >= def.tiers) {
      rows.push(el('div', { class: 'inote maxed', text: 'Maximum tier reached' }));
    }

    if (b.anchor) {
      rows.push(el('button', {
        class: 'ibull', text: `Bulldoze — ${money(getDef('bulldoze').cost)}`,
        onclick: () => this.app.bulldozeAt(x, y),
      }));
    }

    const mods = describeModifiers(s);
    if (mods.length) {
      rows.push(el('div', { class: 'isect', text: 'Active effects' }));
      for (const m of mods.slice(0, 5)) {
        rows.push(el('div', { class: `irow mod ${m.value >= 1 ? 'good' : 'bad'}` }, [
          el('span', { class: 'ik', text: m.label }),
          el('span', { class: 'iv', text: `${m.days}d left` }),
        ]));
      }
    }

    this.root.append(...rows);
  }

  hasRoad(x, y) {
    const s = this.app.game.state;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= s.grid.w || ny >= s.grid.h) continue;
      const b = s.grid.buildings[ny * s.grid.w + nx];
      if (b && (b.def === 'road' || b.def === 'boulevard')) return true;
    }
    return false;
  }

  svcRow(b) {
    const items = [
      ['health', 'Health', '#F2647E'],
      ['education', 'Schools', '#FFD166'],
      ['safety', 'Safety', '#4C7CE0'],
      ['transit', 'Transit', '#7C6FE0'],
    ];
    return el('div', { class: 'isect', text: 'Services' },
      items.map(([k, label, color]) => el('div', { class: 'isvc' }, [
        el('span', { class: 'dot', style: { background: color } }),
        el('span', { class: 'ikl', text: label }),
        el('span', { class: `iv ${b.svc && b.svc[k] ? 'good' : 'bad'}`, text: b.svc && b.svc[k] ? 'Covered' : 'None' }),
      ]))
    );
  }

  terrainPanel(x, y) {
    const s = this.app.game.state;
    const t = s.grid.terrain[y * s.grid.w + x];
    const names = ['Grass', 'Water', 'Sand', 'Rock', 'Forest'];
    return [
      el('div', { class: 'ihead empty' }, [
        el('span', { class: 'iswatch' }),
        el('div', {}, [
          el('div', { class: 'ititle', text: names[t] || 'Unknown' }),
          el('div', { class: 'isub', text: `tile ${x},${y} · empty land` }),
        ]),
      ]),
      el('div', { class: 'inote', text: t === 1
        ? 'Open water. Nothing can be built here.'
        : 'Pick a structure from the palette to build here.' }),
    ];
  }

  hide() { this.root.classList.add('hidden'); }
}

/* ── tooltip ────────────────────────────────────────────────────────────── */

/**
 * Native `title` tooltips are slow and unstylable, so they are intercepted and
 * re-rendered as a styled node. The original text is stashed on `data-title`
 * and restored on pointer-out so the DOM stays honest.
 */
export class Tooltip {
  constructor() {
    this.node = el('div', { class: 'tooltip hidden' });
    document.body.append(this.node);
    document.addEventListener('pointerover', (e) => {
      const t = e.target.closest('[title]');
      if (!t) return;
      const text = t.getAttribute('title');
      if (!text) return;
      t.dataset.title = text;
      t.removeAttribute('title');
      this.show(text, e.clientX, e.clientY);
    });
    document.addEventListener('pointermove', (e) => {
      if (!this.node.classList.contains('hidden')) this.move(e.clientX, e.clientY);
    });
    document.addEventListener('pointerout', (e) => {
      const t = e.target.closest('[data-title]');
      if (!t) return;
      t.setAttribute('title', t.dataset.title);
      delete t.dataset.title;
      this.hide();
    });
  }

  show(text, x, y) {
    this.node.textContent = text;
    this.node.classList.remove('hidden');
    this.move(x, y);
  }

  move(x, y) {
    const r = this.node.getBoundingClientRect();
    let left = x + 14, top = y + 18;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 18;
    this.node.style.left = `${Math.max(8, left)}px`;
    this.node.style.top = `${Math.max(8, top)}px`;
  }

  hide() { this.node.classList.add('hidden'); }
}

/* ── toasts ─────────────────────────────────────────────────────────────── */

export class Toasts {
  constructor() { this.root = $('#toasts'); }

  push({ text, tone = 'info', ttl = 4000 }) {
    const node = el('div', { class: `toast ${tone}` }, [
      el('span', { class: 'toast-ico' }),
      el('span', { class: 'toast-text', text }),
    ]);
    this.root.append(node);
    requestAnimationFrame(() => node.classList.add('in'));
    setTimeout(() => {
      node.classList.remove('in');
      node.classList.add('out');
      setTimeout(() => node.remove(), 350);
    }, ttl);
    while (this.root.children.length > 5) this.root.firstChild.remove();
  }
}

/* ── budget panel ───────────────────────────────────────────────────────── */

export class BudgetPanel {
  constructor(app) {
    this.app = app;
    this.root = $('#budget');
    this.root.classList.add('hidden');
    app.bus.on(EV.TICK, () => { if (!this.root.classList.contains('hidden')) this.refresh(); });
  }

  toggle() {
    this.root.classList.toggle('hidden');
    if (!this.root.classList.contains('hidden')) this.refresh();
  }

  refresh() {
    const s = this.app.game.state;
    const eco = s.economy;
    const b = eco.breakdown || {};
    const debt = totalDebt(s);
    const runway = runwayTicks(s);
    const row = (k, v, cls = '') => el('div', { class: `brow ${cls}` }, [
      el('span', { class: 'bk', text: k }), el('span', { class: 'bv', text: v }),
    ]);

    this.root.innerHTML = '';
    this.root.append(
      el('div', { class: 'bhead' }, [
        el('h3', { text: 'Treasury' }),
        el('button', { class: 'bclose', text: '\u2715', onclick: () => this.toggle() }),
      ]),
      el('div', { class: 'bbig' }, [
        el('div', { class: `bnet ${eco.net >= 0 ? 'good' : 'bad'}` }, [
          el('span', { class: 'bnet-val', text: signed(eco.net) }),
          el('span', { class: 'bnet-lab', text: 'per tick' }),
        ]),
        el('div', { class: 'bcash' }, [
          el('span', { class: 'bk', text: 'Balance' }),
          el('span', { class: 'bv', text: money(eco.cash) }),
        ]),
      ]),
      el('div', { class: 'bsect', text: 'Income' }),
      row('Residential tax', signed(b.fromResidential || 0)),
      row('Commercial tax', signed(b.fromCommercial || 0)),
      row('Industrial tax', signed(b.fromIndustrial || 0)),
      row('Total income', signed(eco.income), 'total'),
      el('div', { class: 'bsect', text: 'Expenses' }),
      row('Building upkeep', signed(-(b.upkeep || 0))),
      row('Road upkeep', signed(-(b.roadUpkeep || 0))),
      debt > 0 ? row('Loan interest', signed(-(b.interest || 0)), 'bad') : null,
      row('Total expenses', signed(-eco.expense), 'total'),
      debt > 0 ? el('div', { class: 'bsect', text: 'Debt' }) : null,
      debt > 0 ? row('Outstanding', money(debt), 'bad') : null,
      debt > 0 ? el('button', { class: 'brepay', text: 'Repay a loan', onclick: () => this.app.repayLoan() }) : null,
      eco.net < 0
        ? el('div', { class: 'bwarn', text: `Deficit — the treasury empties in ${runway === Infinity ? '\u221e' : fmt(runway)} ticks. Happiness is falling.` })
        : null,
      el('div', { class: 'bsect', text: 'Coverage' }),
      ...['health', 'education', 'safety', 'transit'].map((k) => el('div', { class: 'brow' }, [
        el('span', { class: 'bk', text: k[0].toUpperCase() + k.slice(1) }),
        el('span', {
          class: `bv ${(s.city.coverage[k] || 0) > 0.5 ? 'good' : 'bad'}`,
          text: `${Math.round((s.city.coverage[k] || 0) * 100)}%`,
        }),
      ])),
    );
  }
}
