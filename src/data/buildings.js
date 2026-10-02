/**
 * buildings.js — the entire build catalogue.
 *
 * Every entry is pure data. The renderer derives its procedural sprite from
 * `sprite` + `palette`, the systems read the numeric fields, and the UI reads
 * `label`/`cost`/`desc`. Adding a building = adding one object here.
 *
 * Fields
 * ──────
 * id        unique key, also the save-file identifier (never rename!)
 * zone      residential|commercial|industrial|park|civic|service|road|tool
 * w,h       footprint in tiles (2x2 buildings must be placed with room)
 * cost      one-off construction cost in ¤
 * upkeep    ¤ per tick (0 = free)
 * unlockPop population milestone that reveals it in the palette
 * jobs      workplaces created per unit of occupancy (C/I)
 * housing   residents at full occupancy (R)
 * service   service definition: {key, radius, capacity}
 * sprite    procedural sprite recipe name (see render/sprites.js)
 * tiers     how many visual + capacity upgrade tiers exist (max 4)
 */

export const TIERS = Object.freeze({
  /** multiplier applied to housing/jobs at tier n (index 0 = tier 1). */
  CAPACITY: [1, 1.8, 3.1, 5.0],
  /** multiplier applied to upkeep at tier n. */
  UPKEEP: [1, 1.9, 3.2, 5.2],
  /** upgrade cost as a fraction of base cost, index 0 = tier1 -> tier2. */
  UPGRADE_COST: [0.9, 1.6, 2.6],
});

export const BUILDINGS = Object.freeze({
  /* ── roads ───────────────────────────────────────────────────────────── */
  road: {
    id: 'road', zone: 'road', label: 'Road', w: 1, h: 1, cost: 10, upkeep: 0,
    unlockPop: 0, tiers: 1, sprite: 'road',
    desc: 'Connects everything. Buildings within 1 tile of a road get access.',
    hotkey: 'R',
  },
  boulevard: {
    id: 'boulevard', zone: 'road', label: 'Boulevard', w: 1, h: 1, cost: 34, upkeep: 0,
    unlockPop: 400, tiers: 1, sprite: 'road', trafficCap: 3, avenue: true,
    desc: 'Three lanes of capacity. Eases congestion in dense districts.',
    hotkey: 'B',
  },

  /* ── zones ───────────────────────────────────────────────────────────── */
  residential: {
    id: 'residential', zone: 'residential', label: 'Housing', w: 1, h: 1, cost: 50,
    upkeep: 0.3, unlockPop: 0, tiers: 4, housing: 8, sprite: 'residential',
    desc: 'Zoned homes. Fills up when there are jobs, power, water and parks.',
    hotkey: '1',
  },
  commercial: {
    id: 'commercial', zone: 'commercial', label: 'Shops', w: 1, h: 1, cost: 65,
    upkeep: 0.4, unlockPop: 0, tiers: 4, jobs: 6, sprite: 'commercial',
    desc: 'Shops and offices. Employs citizens and generates sales tax.',
    hotkey: '2',
  },
  industrial: {
    id: 'industrial', zone: 'industrial', label: 'Industry', w: 1, h: 1, cost: 80,
    upkeep: 0.5, unlockPop: 0, tiers: 4, jobs: 8, sprite: 'industrial',
    desc: 'Factories and warehouses. Best-paying jobs, but pollutes neighbours.',
    hotkey: '3',
    pollution: 1.0,
  },
  park: {
    id: 'park', zone: 'park', label: 'Park', w: 1, h: 1, cost: 60, upkeep: 0.3,
    unlockPop: 0, tiers: 4, sprite: 'park', radius: 3, mood: 6,
    desc: 'Raises happiness for every home within 3 tiles.',
    hotkey: '4',
  },
  plaza: {
    id: 'plaza', zone: 'park', label: 'Grand Plaza', w: 2, h: 2, cost: 320,
    upkeep: 1.2, unlockPop: 900, tiers: 4, sprite: 'plaza', radius: 5, mood: 12,
    desc: 'A civic heart. Large radius, large mood bonus.',
    hotkey: 'P',
  },
  civic: {
    id: 'civic', zone: 'civic', label: 'Town Hall', w: 2, h: 2, cost: 600,
    upkeep: 2.4, unlockPop: 1200, tiers: 4, sprite: 'civic', radius: 6, mood: 9,
    desc: 'Seat of government. Boosts tax efficiency city-wide by 4% per tier.',
    hotkey: 'T',
    taxBonus: 0.04,
  },
  stadium: {
    id: 'stadium', zone: 'civic', label: 'Stadium', w: 2, h: 2, cost: 1400,
    upkeep: 4.5, unlockPop: 3600, tiers: 4, sprite: 'stadium', radius: 8, mood: 16,
    desc: 'Weekend magnet. Huge mood radius, big upkeep.',
    hotkey: 'S',
  },

  /* ── services ────────────────────────────────────────────────────────── */
  powerPlant: {
    id: 'powerPlant', zone: 'service', label: 'Power Plant', w: 2, h: 2, cost: 500,
    upkeep: 3.0, unlockPop: 0, tiers: 4, sprite: 'power',
    service: { key: 'power', capacity: 90 }, pollution: 1.4,
    desc: 'Supplies 90 power per tier. Buildings without power do not grow.',
    hotkey: 'E',
  },
  solarFarm: {
    id: 'solarFarm', zone: 'service', label: 'Solar Farm', w: 2, h: 2, cost: 900,
    upkeep: 1.8, unlockPop: 2200, tiers: 4, sprite: 'solar',
    service: { key: 'power', capacity: 70 },
    desc: 'Clean 70 power per tier. No pollution penalty.',
    hotkey: 'L',
  },
  waterTower: {
    id: 'waterTower', zone: 'service', label: 'Water Tower', w: 1, h: 1, cost: 240,
    upkeep: 1.0, unlockPop: 0, tiers: 4, sprite: 'water',
    service: { key: 'water', capacity: 70, radius: 99 },
    desc: 'City-wide water. Every home and shop needs a supply.',
    hotkey: 'W',
  },
  school: {
    id: 'school', zone: 'service', label: 'School', w: 1, h: 1, cost: 300,
    upkeep: 1.5, unlockPop: 120, tiers: 4, sprite: 'school',
    service: { key: 'education', radius: 7, capacity: 60 }, mood: 3,
    desc: 'Educated citizens pay more tax. Radius 7.',
    hotkey: 'U',
  },
  hospital: {
    id: 'hospital', zone: 'service', label: 'Hospital', w: 2, h: 2, cost: 800,
    upkeep: 3.5, unlockPop: 400, tiers: 4, sprite: 'hospital',
    service: { key: 'health', radius: 9, capacity: 120 }, mood: 4,
    desc: 'Health coverage, radius 9. Reduces death rate and boosts mood.',
    hotkey: 'H',
  },
  fireStation: {
    id: 'fireStation', zone: 'service', label: 'Fire Station', w: 1, h: 1, cost: 260,
    upkeep: 1.4, unlockPop: 120, tiers: 4, sprite: 'fire',
    service: { key: 'safety', radius: 6, capacity: 1 },
    desc: 'Puts out fires. Radius 6. Uncovered zones burn during events.',
    hotkey: 'F',
  },
  policeStation: {
    id: 'policeStation', zone: 'service', label: 'Police Station', w: 1, h: 1,
    cost: 280, upkeep: 1.6, unlockPop: 600, tiers: 4, sprite: 'police',
    service: { key: 'safety', radius: 7, capacity: 1 }, mood: 2,
    desc: 'Crime prevention. Radius 7.',
    hotkey: 'G',
  },
  subway: {
    id: 'subway', zone: 'service', label: 'Metro Station', w: 1, h: 1, cost: 700,
    upkeep: 2.6, unlockPop: 3000, tiers: 4, sprite: 'subway',
    service: { key: 'transit', radius: 6, capacity: 1 },
    desc: 'Cuts congestion in a 6-tile radius by 45%.',
    hotkey: 'M',
    trafficRelief: 0.45,
  },

  /* ── tools (not buildings, but share the palette) ────────────────────── */
  bulldoze: {
    id: 'bulldoze', zone: 'tool', label: 'Bulldoze', w: 1, h: 1, cost: 4, upkeep: 0,
    unlockPop: 0, tiers: 1, sprite: 'tool',
    desc: 'Clears forest, rock or an existing structure. 40% of cost refunded.',
    hotkey: 'X',
  },
  inspect: {
    id: 'inspect', zone: 'tool', label: 'Inspect', w: 1, h: 1, cost: 0, upkeep: 0,
    unlockPop: 0, tiers: 1, sprite: 'tool',
    desc: 'Click anything to read its stats in the inspector.',
    hotkey: 'I',
  },
});

export const BUILD_ORDER = Object.freeze([
  'road', 'boulevard',
  'residential', 'commercial', 'industrial', 'park', 'plaza', 'civic', 'stadium',
  'powerPlant', 'solarFarm', 'waterTower', 'school', 'hospital',
  'fireStation', 'policeStation', 'subway',
  'bulldoze', 'inspect',
]);

/** Look up a definition; unknown ids (old saves) resolve to null, not a throw. */
export function getDef(id) {
  return BUILDINGS[id] || null;
}

/** True when the definition can be dragged across tiles (roads, zones). */
export function isDraggable(id) {
  const d = BUILDINGS[id];
  return !!d && d.w === 1 && d.h === 1;
}

/** True for anything the economy charges upkeep on. */
export function hasUpkeep(id) {
  const d = BUILDINGS[id];
  return !!d && d.upkeep > 0;
}
