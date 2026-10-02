/**
 * daynight.js — the visual + calendar clock.
 *
 * Runs on render frames (not sim ticks) so the sun glides smoothly while the
 * simulation stays on its coarse 2.5 s heartbeat.
 *
 * Lighting model
 * ──────────────
 *   clock 0.00 midnight ─ 0.25 dawn ─ 0.50 noon ─ 0.75 dusk ─ 1.00 midnight
 *
 * `light` is 0 (full night) .. 1 (full day) and drives the multiply overlay.
 * `windowGlow` is the inverse with a soft shoulder, so lamps come on slightly
 * before it is truly dark and stay on slightly after sunrise.
 */

export const TICKS_PER_DAY = 8;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DAYS_PER_SEASON = 12;

/** Real seconds for one full in-game day at speed 1. */
export const SECONDS_PER_DAY = 96;

export function createClock() {
  return { clock: 0.28, day: 1, season: 'spring', phase: 'day' };
}

/** Advance the visual clock. `dt` seconds, `speed` 0..3. */
export function advance(clock, dt, speed) {
  if (speed <= 0) return clock;
  const rate = [0, 1, 2.4, 4.5][speed] || 1;
  clock.clock += (dt / SECONDS_PER_DAY) * rate;
  while (clock.clock >= 1) {
    clock.clock -= 1;
    clock.day += 1;
    const s = Math.floor(((clock.day - 1) / DAYS_PER_SEASON) % 4);
    clock.season = SEASONS[s];
  }
  clock.phase = phaseOf(clock.clock);
  return clock;
}

export function phaseOf(clock) {
  if (clock < 0.2) return 'night';
  if (clock < 0.32) return 'dawn';
  if (clock < 0.68) return 'day';
  if (clock < 0.8) return 'dusk';
  return 'night';
}

/** Smooth daylight curve, 0 = midnight, 1 = noon. */
export function lightLevel(clock) {
  // Raised cosine centred on noon, with a flat night floor.
  const x = (clock - 0.5) * Math.PI * 2;
  const raw = 0.5 + 0.5 * Math.cos(x);
  const shaped = Math.pow(raw, 0.72);
  return Math.max(0.08, shaped);
}

/** How strongly window lights and street lamps read. 0 = day, 1 = full night. */
export function windowGlow(clock) {
  const l = lightLevel(clock);
  return Math.min(1, Math.max(0, (0.72 - l) / 0.5));
}

/** Multiply-tint alpha for the night pass. */
export function nightAlpha(clock) {
  return (1 - lightLevel(clock)) * 0.62;
}

/** Sky gradient colours for the given clock value (see render/renderer.js). */
export function skyColors(clock) {
  const stops = [
    { t: 0.0, top: '#0B1430', bot: '#1B2B4D' },
    { t: 0.22, top: '#2A3358', bot: '#6C5A7A' },
    { t: 0.3, top: '#7E7FA8', bot: '#FFC58A' },
    { t: 0.42, top: '#8FCDE8', bot: '#D9EEF7' },
    { t: 0.6, top: '#8FCDE8', bot: '#D9EEF7' },
    { t: 0.72, top: '#8E7FA8', bot: '#FFB47A' },
    { t: 0.8, top: '#3E3560', bot: '#C4636B' },
    { t: 1.0, top: '#0B1430', bot: '#1B2B4D' },
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (clock >= a.t && clock <= b.t) {
      const k = (clock - a.t) / (b.t - a.t);
      return { top: lerpHex(a.top, b.top, k), bot: lerpHex(a.bot, b.bot, k) };
    }
  }
  return { top: stops[0].top, bot: stops[0].bot };
}

function lerpHex(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `rgb(${r},${g},${bl})`;
}

/** Sun/moon position for the shadow direction, in radians. */
export function sunAngle(clock) {
  return -Math.PI / 2 + (clock - 0.5) * Math.PI * 1.15;
}
