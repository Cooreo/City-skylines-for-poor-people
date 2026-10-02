/**
 * progression.js (system) — unlock gates, milestone announcements, victory.
 *
 * Runs last in the tick so it reports on the numbers the rest of the tick
 * just produced.
 */

import { BUILDINGS } from '../data/buildings.js';
import { MILESTONES, VICTORY, nextMilestone } from '../data/progression.js';
import { EV } from '../core/eventbus.js';

export function update(state, bus) {
  const pop = state.city.pop;

  /* ── building unlocks ────────────────────────────────────────────────── */
  for (const id in BUILDINGS) {
    const def = BUILDINGS[id];
    if (def.unlockPop > 0 && pop >= def.unlockPop && !state.unlocked.includes(id)) {
      state.unlocked.push(id);
      bus.emit(EV.UNLOCK, { defId: id, label: def.label, pop: def.unlockPop });
      bus.emit(EV.TOAST, { text: `Unlocked: ${def.label}`, tone: 'unlock', ttl: 5000 });
    }
  }

  /* ── milestones ──────────────────────────────────────────────────────── */
  for (const m of MILESTONES) {
    if (pop >= m.pop && !state.seenMilestones.includes(m.pop)) {
      state.seenMilestones.push(m.pop);
      bus.emit(EV.MILESTONE, m);
    }
  }

  /* ── victory ─────────────────────────────────────────────────────────── */
  if (!state.won && pop >= VICTORY.goalPop && state.city.happiness >= VICTORY.goalHappiness) {
    state.won = true;
    state.victoryMedals = VICTORY.medals
      .filter((m) => safe(m.test, state))
      .map((m) => ({ id: m.id, label: m.label, text: m.text }));
    bus.emit(EV.VICTORY, { medals: state.victoryMedals, stats: state.stats, day: state.day });
  }

  state.city.nextMilestone = nextMilestone(pop);
  return state;
}

function safe(fn, state) {
  try { return !!fn(state); } catch { return false; }
}
