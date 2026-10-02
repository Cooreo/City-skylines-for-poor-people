# 05 — Asset List

The short version: **there are no binary assets.** Every visual in Micro
Metropolis is drawn procedurally into a canvas at runtime. That is a deliberate
architectural choice, not an oversight.

What follows is the *logical* asset inventory — the things a conventional build
would ship as files — with priorities. If you ever do decide to commission art,
this is the shopping list.

---

## Must-have (the game is not shippable without these)

All of these exist as code today.

### Terrain tiles — 5

| Asset | Priority | Status | Notes |
|---|---|---|---|
| Grass (2 variants) | P0 | ✅ procedural | per-tile tufts from a hash |
| Water (2 depths) | P0 | ✅ procedural | animated foam overlay |
| Sand | P0 | ✅ procedural | shoreline + speckle |
| Rock | P1 | ✅ procedural | highland outcrop |
| Forest floor | P1 | ✅ procedural | base for tree scatter |

### Buildings — 17 × 4 tiers × 3 variants

| Asset | Priority | Status |
|---|---|---|
| Road / boulevard | P0 | ✅ |
| Housing T1–T4 | P0 | ✅ |
| Shops T1–T4 | P0 | ✅ |
| Industry T1–T4 | P0 | ✅ |
| Park T1–T4 | P0 | ✅ |
| Power Plant T1–T4 | P0 | ✅ |
| Water Tower T1–T4 | P0 | ✅ |
| School T1–T4 | P0 | ✅ |
| Fire Station T1–T4 | P1 | ✅ |
| Hospital T1–T4 | P0 | ✅ |
| Police Station T1–T4 | P1 | ✅ |
| Grand Plaza T1–T4 | P1 | ✅ |
| Town Hall T1–T4 | P1 | ✅ |
| Solar Farm T1–T4 | P2 | ✅ |
| Metro Station T1–T4 | P2 | ✅ |
| Stadium T1–T4 | P2 | ✅ |
| Bulldoze / inspect cursors | P0 | ✅ |

### Characters and vehicles

| Asset | Priority | Status | Notes |
|---|---|---|---|
| Pedestrian (7 colour variants) | P0 | ✅ procedural | 4.2 px body, swinging legs |
| Car (6 colour variants) | P0 | ✅ procedural | rotated to heading |
| Construction dust | P0 | ✅ | 9 particles per placement |

### UI

| Asset | Priority | Status | Notes |
|---|---|---|---|
| Zone icons (5) | P0 | ✅ CSS gradients | palette swatches |
| Service icons (7) | P0 | ✅ CSS gradients | palette swatches |
| Tool icons (bulldoze, inspect) | P0 | ✅ CSS | |
| Event glyphs (17) | P1 | ✅ Unicode | sun, bolt, wave, trophy… |
| Milestone / medal icons | P2 | ✅ Unicode | ★ |
| Brand mark | P2 | ✅ CSS conic gradient | |

---

## Nice-to-have (would improve the feel, not required)

| Asset | Priority | Why it matters | Effort |
|---|---|---|---|
| **Sound effects** | P1 | The single biggest missing feel cue. Place, demolish, coin, tier-up, event chime, night ambience. | 1 day |
| **Ambient particles** | P2 | Birds at dawn, crickets at night, drifting leaves, chimney smoke on a timer. Purely cosmetic. | 0.5 day |
| **Water Shoreline foam** | P2 | An animated foam ring where water meets sand would sell the island. | 0.5 day |
| **Weather overlay** | P2 | Rain streaks during the flood event, heat shimmer during a heatwave. | 1 day |
| **Citizen portraits** | P3 | Tiny faces in the inspector's occupancy row. Charming, high cost. | 1 day |
| **Vehicle variety** | P3 | Buses, trucks, and a tram on the metro line. | 1 day |
| **Night window patterns** | P3 | Per-building deterministic window layouts so a skyline is recognisable. | 0.5 day |
| **Seasonal terrain tint** | P3 | Autumn foliage, winter snow. The calendar already tracks seasons. | 1 day |
| **Title screen art** | P3 | A illustrated island for the loading state. | 1 day |
| **Tutorial mascot** | P3 | A small advisor character for the guided intro. | 2 days |

---

## Explicitly out of scope

| Asset | Why not |
|---|---|
| Sprite sheets / texture atlases | Everything is procedural and cached at runtime; a sheet would add a binary file and a loading step for no gain. |
| 3D models | The brief is Canvas 2D. |
| Photorealistic terrain | Contradicts the "slightly stylised" tone. |
| Localised text | English only for v1; all strings already live in `data/` so extraction is mechanical. |
| Music | A loop would need a binary asset and gets irritating fast. Procedural WebAudio blips are the better trade. |

---

## If you do commission art

Constraints to hand the artist:

1. **Isometric 2:1.** Tiles are 64 × 32 px at zoom 1. Buildings may extend up to
   96 px above the tile diamond.
2. **No baked lighting.** Day/night is applied at runtime: a multiply tint plus
   additive window glow. Windows must be a distinguishable colour region so the
   night pass can find them.
3. **Anchor at the bottom centre** of the tile, so the painter's algorithm sorts
   correctly.
4. **Four silhouettes per zone**, not four recolours. Footprint and massing must
   change, or the tiers are unreadable at a glance.
5. **Palette locked** to `src/data/palette.js`. If a colour is missing, add it
   there first — never inline a hex.
6. **Export as PNG with transparency**, or better, as an SVG path list that can
   be dropped into `render/sprites.js` as draw calls.

---

## Current repository contents

```
index.html                     2.1 kB
styles/main.css               17 kB
src/**/*.js                   ~190 kB   (31 modules, heavily commented)
test/**/*.js                   ~55 kB
docs/**/*.md                   ~90 kB
tools/balance-report.mjs       5 kB
─────────────────────────────────────
total                         ~360 kB, zero binary files
```

For comparison, a single 2048×2048 texture atlas is 8–16 MB. The entire game —
code, tests and documentation — is smaller than one texture.
