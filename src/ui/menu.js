/**
 * menu.js — help, pause menu and the save/load screen.
 *
 * The save menu lists the four slots with a summary line drawn from the index
 * (day, population, cash) so the player can tell them apart without parsing
 * every save file.
 */

import { $, el, money, fmt } from './dom.js';
import { SLOTS, listSaves, readIndex } from '../core/save.js';

export class Menu {
  constructor(app) {
    this.app = app;
    this.root = $('#overlay');
    this.current = null;
  }

  open(kind) {
    this.close();
    this.current = kind;
    const panel = kind === 'help' ? this.help() : kind === 'menu' ? this.menu() : this.saves();
    const close = () => {
      panel.classList.add('leaving');
      setTimeout(() => backdrop.remove(), 240);
    };
    const backdrop = el('div', { class: 'overlay-backdrop soft' }, [panel]);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    this.root.append(backdrop);
    this._close = close;
  }

  close() { this._close?.(); this.current = null; }

  menu() {
    const app = this.app;
    return el('div', { class: 'sheet' }, [
      el('h2', { class: 'sheet-title', text: 'Menu' }),
      el('div', { class: 'sheet-actions' }, [
        btn('Save game', '\u25b6', () => app.save(1)),
        btn('Load game', '\u25b6', () => this.open('saves')),
        btn('New city', '\u25b6', () => app.newGame()),
        btn('How to play', '\u25b6', () => this.open('help')),
        btn(reduceMotion(app) ? 'Motion: reduced' : 'Motion: full', '\u25b6', () => {
          const on = !reduceMotion(app);
          app.game.state.settings.reduceMotion = on;
          app.renderer.reduceMotion = on;
          app.particles.enabled = !on;
          this.close();
          this.open('menu');
        }),
      ]),
      el('div', { class: 'sheet-note', text: 'Progress autosaves to slot 0 every 20 ticks.' }),
    ]);
  }

  help() {
    const rows = [
      ['Goal', `Grow to ${fmt(this.app.goalPop)} citizens while keeping happiness above ${fmt(this.app.goalHappiness)}%.`],
      ['Build', 'Pick a structure from the bottom palette, then click a tile. Drag to lay roads and zones in a line.'],
      ['Roads', 'Every building must sit within one tile of a road, or it will never fill up.'],
      ['Utilities', 'Power and water are rationed when demand exceeds supply. Watch the ratios in the budget panel.'],
      ['Services', 'Schools, hospitals, fire, police and metro cover a radius. Uncovered zones are unhappy.'],
      ['Zones', 'Zoned lots fill up on their own and upgrade through four tiers when they stay full.'],
      ['Economy', 'Residential tax pays for everything. Commercial is the workhorse; industry creates jobs but pollutes.'],
      ['Deficit', 'Running out of money triggers an emergency loan. Too many and the treasury mothballs services.'],
      ['Camera', 'Drag with the right mouse button to pan, scroll to zoom. WASD or the arrow keys also pan.'],
      ['Hotkeys', '1-4 zones, R road, E power, W water, X bulldoze, I inspect, Space pause, +/- speed.'],
    ];
    return el('div', { class: 'sheet wide' }, [
      el('h2', { class: 'sheet-title', text: 'How to play' }),
      el('div', { class: 'helpgrid' }, rows.map(([k, v]) => el('div', { class: 'helprow' }, [
        el('div', { class: 'helpk', text: k }),
        el('div', { class: 'helpv', text: v }),
      ]))),
      el('button', { class: 'vbtn primary', text: 'Got it', onclick: () => this.close() }),
    ]);
  }

  saves() {
    const app = this.app;
    const index = readIndex();
    const rows = SLOTS.map((slot) => {
      const meta = index[slot.id];
      const exists = listSaves().find((s) => s.id === slot.id && s.exists);
      return el('div', { class: `saverow ${exists ? '' : 'empty'}` }, [
        el('div', { class: 'saveinfo' }, [
          el('div', { class: 'savename', text: slot.label }),
          el('div', {
            class: 'savemeta',
            text: meta
              ? `Day ${meta.day} · ${fmt(meta.pop)} citizens · ${money(meta.cash)}`
              : exists ? 'Older save' : 'Empty',
          }),
        ]),
        el('div', { class: 'saveacts' }, [
          exists ? el('button', { class: 'vbtn', text: 'Load', onclick: () => app.load(slot.id) }) : null,
          !slot.auto ? el('button', { class: 'vbtn', text: 'Save', onclick: () => app.save(slot.id) }) : null,
        ]),
      ]);
    });
    return el('div', { class: 'sheet' }, [
      el('h2', { class: 'sheet-title', text: 'Save / Load' }),
      el('div', { class: 'savelist' }, rows),
      el('div', { class: 'sheet-note', text: 'Saves live in this browser only. Nothing is uploaded anywhere.' }),
      el('button', { class: 'vbtn', text: 'Back', onclick: () => this.open('menu') }),
    ]);
  }

  get goalPop() { return this.app.game.state._goalPop || 4000; }
  get goalHappiness() { return this.app.game.state._goalHappiness || 68; }
}

/** The App keeps state on `game.state`; the menu reads it through here. */
const reduceMotion = (app) => !!app.game.state.settings.reduceMotion;

function btn(label, ico, onclick) {
  return el('button', { class: 'sbtn', onclick }, [
    el('span', { class: 'sbtn-ico', text: ico }),
    el('span', { text: label }),
  ]);
}
