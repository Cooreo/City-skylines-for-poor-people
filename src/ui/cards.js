/**
 * cards.js — the random-event card deck, as UI.
 *
 * A card is a modal panel with a title, an illustration glyph, a blurb and
 * two or three choices. The simulation is paused while a card is open, so the
 * player never loses ground to a decision they have not made yet.
 *
 * The card is the main narrative surface of the game: it is where the
 * simulation's numbers turn into a story ("the auditor has run out of ways to
 * be diplomatic about the books").
 */

import { $, el, money } from './dom.js';
import { EV } from '../core/eventbus.js';

const ICONS = {
  sun: '\u2600', camera: '\u25ce', crack: '\u26a0', fire: '\u25b2', mask: '\u25c6',
  rocket: '\u2726', sign: '\u270e', lantern: '\u25c7', bolt: '\u26a1', wave: '\u2248',
  siren: '\u25c9', scroll: '\u2261', pick: '\u2692', cloud: '\u2601', trophy: '\u2605',
  hole: '\u25cb', vault: '\u25a0',
};

export class EventCards {
  constructor(app) {
    this.app = app;
    this.root = $('#overlay');
    this.stack = [];
    app.bus.on(EV.EVENT_SHOW, (event) => this.show(event));
    app.bus.on(EV.EVENT_RESOLVE, ({ result }) => {
      app.ui.toasts.push({ text: result, tone: 'info', ttl: 6000 });
      app.refreshUI();
    });
  }

  show(event) {
    const card = el('div', { class: 'card', role: 'dialog', 'aria-modal': 'true' }, [
      el('div', { class: 'card-art' }, [
        el('span', { class: 'card-glyph', text: ICONS[event.icon] || '\u2726' }),
      ]),
      el('div', { class: 'card-body' }, [
        el('div', { class: 'card-kicker', text: 'City bulletin' }),
        el('h2', { class: 'card-title', text: event.title }),
        el('p', { class: 'card-blurb', text: event.blurb }),
        el('div', { class: 'card-choices' }, event.choices.map((c, i) => el('button', {
          class: 'choice',
          onclick: () => this.resolve(event, i),
        }, [
          el('span', { class: 'choice-label', text: c.label }),
          el('span', { class: 'choice-hint', text: c.hint }),
        ]))),
      ]),
    ]);

    const backdrop = el('div', { class: 'overlay-backdrop' }, [card]);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this.resolve(event, 0); });
    this.root.append(backdrop);
    this.stack.push(backdrop);
    // focus the first choice so the keyboard works immediately
    requestAnimationFrame(() => card.querySelector('.choice')?.focus());
  }

  resolve(event, index) {
    const backdrop = this.stack.pop();
    if (backdrop) {
      backdrop.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 220);
    }
    this.app.game.resolveEvent(index);
  }

  get isOpen() { return this.stack.length > 0; }
}

/* ── milestone banners ──────────────────────────────────────────────────── */

export class Milestones {
  constructor(app) {
    this.app = app;
    this.root = $('#overlay');
    app.bus.on(EV.MILESTONE, (m) => this.show(m));
  }

  show(m) {
    const panel = el('div', { class: 'milestone' }, [
      el('div', { class: 'ms-kicker', text: 'Milestone reached' }),
      el('h2', { class: 'ms-title', text: m.title }),
      el('p', { class: 'ms-text', text: m.text }),
      el('div', { class: 'ms-reward' }, [
        el('span', { class: 'ms-reward-label', text: 'Unlocked' }),
        el('span', { class: 'ms-reward-val', text: m.reward }),
      ]),
      el('button', { class: 'ms-btn', text: 'Carry on', onclick: () => close() }),
    ]);
    const close = () => {
      panel.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 260);
    };
    const backdrop = el('div', { class: 'overlay-backdrop soft' }, [panel]);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    this.root.append(backdrop);
    this.app.ui.toasts.push({ text: `${m.title} — ${m.reward}`, tone: 'unlock', ttl: 6000 });
  }
}

/* ── victory ────────────────────────────────────────────────────────────── */

export class Victory {
  constructor(app) {
    this.app = app;
    this.root = $('#overlay');
    app.bus.on(EV.VICTORY, (v) => this.show(v));
  }

  show({ medals, stats, day }) {
    const s = this.app.game.state;
    const panel = el('div', { class: 'victory' }, [
      el('div', { class: 'vic-kicker', text: 'Campaign complete' }),
      el('h2', { class: 'vic-title', text: 'Your metropolis is finished' }),
      el('p', { class: 'vic-sub', text: `Day ${day} · ${s.city.pop.toLocaleString('en-US')} citizens · ${Math.round(s.city.happiness)}% happy` }),
      el('div', { class: 'vic-medals' }, medals.length
        ? medals.map((m) => el('div', { class: 'medal' }, [
          el('span', { class: 'medal-ico', text: '\u2605' }),
          el('div', {}, [
            el('div', { class: 'medal-label', text: m.label }),
            el('div', { class: 'medal-text', text: m.text }),
          ]),
        ]))
        : el('div', { class: 'medal none', text: 'No medals — try a cleaner, happier run.' })),
      el('div', { class: 'vic-stats' }, [
        stat('Citizens housed', s.stats.bestPop.toLocaleString('en-US')),
        stat('Structures built', String(s.stats.built)),
        stat('Events resolved', String(s.stats.eventsResolved)),
        stat('Best happiness', `${Math.round(s.stats.bestHappiness)}%`),
        stat('Total earned', money(s.economy.totalEarned)),
      ]),
      el('div', { class: 'vic-actions' }, [
        el('button', { class: 'vbtn primary', text: 'Keep building', onclick: () => close() }),
        el('button', { class: 'vbtn', text: 'New city', onclick: () => { close(); this.app.newGame(); } }),
      ]),
    ]);
    const close = () => {
      panel.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 260);
    };
    const backdrop = el('div', { class: 'overlay-backdrop soft' }, [panel]);
    this.root.append(backdrop);

    function stat(k, v) {
      return el('div', { class: 'vstat' }, [
        el('span', { class: 'vstat-k', text: k }),
        el('span', { class: 'vstat-v', text: v }),
      ]);
    }
  }
}
