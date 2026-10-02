/**
 * palette.js — single source of truth for every colour in Micro Metropolis.
 *
 * Nothing else in the codebase may hard-code a hex string; the renderer reads
 * from here and docs/03-VISUAL-STYLE.md is generated from these values.
 *
 * Naming: <surface><shade?>  e.g. grassLight, road, uiPanel.
 */

export const PALETTE = Object.freeze({
  /* ── terrain ─────────────────────────────────────────────────────────── */
  grass: '#7FC97A',
  grassAlt: '#72BE6D',
  grassDark: '#5FA85C',
  water: '#4FB3D9',
  waterDeep: '#2E8FBF',
  waterFoam: '#A8E4F5',
  sand: '#EBD9A8',
  sandDark: '#D9C48E',
  rock: '#9AA3AE',
  rockDark: '#7B8592',
  forest: '#3F9A5F',
  forestDark: '#2F7D4C',

  /* ── infrastructure ──────────────────────────────────────────────────── */
  road: '#5A6270',
  roadDark: '#454C58',
  roadMark: '#F2E9C9',
  sidewalk: '#C3C9D2',

  /* ── zones ───────────────────────────────────────────────────────────── */
  residential: '#E9776E',
  residentialDark: '#C4564F',
  commercial: '#F2B441',
  commercialDark: '#C9932C',
  industrial: '#8E9BB3',
  industrialDark: '#6E7B93',
  park: '#58C172',
  parkDark: '#3E9C58',
  civic: '#7C6FE0',
  civicDark: '#5D51B8',

  /* ── services ────────────────────────────────────────────────────────── */
  power: '#FFB020',
  powerDark: '#C98414',
  waterTower: '#56B8E6',
  waterTowerDark: '#3C8FBA',
  hospital: '#F2647E',
  school: '#FFD166',
  fire: '#E24E42',
  police: '#4C7CE0',

  /* ── lighting / sky ──────────────────────────────────────────────────── */
  skyDawn: '#FFC58A',
  skyDay: '#BFE6F5',
  skyDusk: '#F58F6E',
  skyNight: '#16213E',
  nightTint: '#13203F',
  windowGlow: '#FFD79A',
  lampGlow: '#FFE2AE',
  shadow: 'rgba(23, 28, 38, 0.20)',
  shadowStrong: 'rgba(23, 28, 38, 0.34)',

  /* ── fx ──────────────────────────────────────────────────────────────── */
  dust: '#C8B99A',
  spark: '#FFE9A8',
  smoke: '#B7BEC9',
  coin: '#FFD166',
  heart: '#FF6B8A',
  leaf: '#8FD97F',

  /* ── UI ──────────────────────────────────────────────────────────────── */
  uiInk: '#171C26',
  uiPanel: '#1E2530',
  uiPanel2: '#262F3D',
  uiPanel3: '#303B4B',
  uiLine: '#35414F',
  uiText: '#E8EDF5',
  uiMuted: '#93A0B2',
  uiAccent: '#4CD4A1',
  uiGold: '#FFD166',
  uiRose: '#FF6B8A',
  uiViolet: '#9B8CFF',
  uiDanger: '#FF5D6C',
});

/**
 * Zone -> theme colours, used by the build palette, inspector chips and the
 * coverage overlays. Keep the key names in sync with data/buildings.js zones.
 */
export const ZONE_THEME = Object.freeze({
  residential: { main: PALETTE.residential, dark: PALETTE.residentialDark, label: 'Residential' },
  commercial: { main: PALETTE.commercial, dark: PALETTE.commercialDark, label: 'Commercial' },
  industrial: { main: PALETTE.industrial, dark: PALETTE.industrialDark, label: 'Industrial' },
  park: { main: PALETTE.park, dark: PALETTE.parkDark, label: 'Park' },
  civic: { main: PALETTE.civic, dark: PALETTE.civicDark, label: 'Civic' },
  service: { main: PALETTE.waterTower, dark: PALETTE.waterTowerDark, label: 'Service' },
  road: { main: PALETTE.sidewalk, dark: PALETTE.road, label: 'Road' },
  tool: { main: PALETTE.uiAccent, dark: PALETTE.uiAccent, label: 'Tool' },
});

/* ── colour helpers ─────────────────────────────────────────────────────── */

const _hexCache = new Map();

/** '#rrggbb' -> {r,g,b} integers. */
export function hexToRgb(hex) {
  let c = _hexCache.get(hex);
  if (c) return c;
  const h = hex.replace('#', '');
  c = {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
  _hexCache.set(hex, c);
  return c;
}

/**
 * Blend two hex colours; t=0 returns `a`. Returns a cached rgb() string so the
 * hot render path never allocates a new string per frame per colour.
 */
const _mixCache = new Map();
export function mix(a, b, t) {
  const key = a + b + (t * 100 | 0);
  const hit = _mixCache.get(key);
  if (hit) return hit;
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const out = `rgb(${Math.round(A.r + (B.r - A.r) * k)},${Math.round(
    A.g + (B.g - A.g) * k
  )},${Math.round(A.b + (B.b - A.b) * k)})`;
  _mixCache.set(key, out);
  return out;
}

/** Deterministic 0..1 hash for per-tile variation (tree sway, grass tufts). */
export function hash01(x, y, salt = 0) {
  let h = x * 374761393 + y * 668265263 + salt * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Shade a hex colour toward black (amt>0) or white (amt<0). */
export function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => (amt >= 0 ? Math.round(v * (1 - amt)) : Math.round(v + (255 - v) * -amt));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export function withAlpha(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
