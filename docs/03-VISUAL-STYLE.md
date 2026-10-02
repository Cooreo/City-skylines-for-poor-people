# 03 — Visual Style Guide

Reference: *Mini Metro* meets *Stardew Valley*, in a browser. Soft shadows,
gentle day/night lighting, animated citizens and vehicles, particles on
construction. Modern, colourful, charming, slightly stylised — never gritty,
never photoreal.

Every colour below lives in `src/data/palette.js` and is mirrored as a CSS
custom property in `styles/main.css`. Nothing in the codebase hard-codes a hex
string.

## 1. Palette

### Terrain

| Token | Hex | Used for |
|---|---|---|
| `grass` | `#7FC97A` | primary ground |
| `grassAlt` | `#72BE6D` | alternate ground tile |
| `grassDark` | `#5FA85C` | grass tufts, shading |
| `water` | `#4FB3D9` | shallow water |
| `waterDeep` | `#2E8FBF` | deep water |
| `waterFoam` | `#A8E4F5` | animated wave highlights |
| `sand` | `#EBD9A8` | beaches |
| `sandDark` | `#D9C48E` | beach speckle |
| `rock` | `#9AA3AE` | highland |
| `rockDark` | `#7B8592` | rock shading |
| `forest` | `#3F9A5F` | tree canopy |
| `forestDark` | `#2F7D4C` | canopy shadow |

### Infrastructure

| Token | Hex | Used for |
|---|---|---|
| `road` | `#5A6270` | asphalt |
| `roadDark` | `#454C58` | kerbs, lane edges |
| `roadMark` | `#F2E9C9` | centre dashes |
| `sidewalk` | `#C3C9D2` | pavements, flat roofs |

### Zones

| Zone | Main | Dark | Label |
|---|---|---|---|
| Residential | `#E9776E` | `#C4564F` | Housing |
| Commercial | `#F2B441` | `#C9932C` | Shops |
| Industrial | `#8E9BB3` | `#6E7B93` | Industry |
| Park | `#58C172` | `#3E9C58` | Park |
| Civic | `#7C6FE0` | `#5D51B8` | Town Hall |

### Services

| Building | Main | Dark |
|---|---|---|
| Power Plant | `#FFB020` | `#C98414` |
| Solar Farm | `#56B8E6` | `#3C8FBA` |
| Water Tower | `#56B8E6` | `#3C8FBA` |
| Hospital | `#F2647E` | — |
| School | `#FFD166` | — |
| Fire Station | `#E24E42` | — |
| Police Station | `#4C7CE0` | — |

### Lighting and sky

| Token | Hex | Used for |
|---|---|---|
| `skyDawn` | `#FFC58A` | dawn gradient stop |
| `skyDay` | `#BFE6F5` | day gradient stop |
| `skyDusk` | `#F58F6E` | dusk gradient stop |
| `skyNight` | `#16213E` | night gradient stop |
| `nightTint` | `#13203F` | multiply overlay |
| `windowGlow` | `#FFD79A` | lit windows |
| `lampGlow` | `#FFE2AE` | street lamps |
| `shadow` | `rgba(23,28,38,.20)` | soft drop shadow |
| `shadowStrong` | `rgba(23,28,38,.34)` | contact shadow |

### Effects

| Token | Hex | Particle |
|---|---|---|
| `dust` | `#C8B99A` | construction |
| `spark` | `#FFE9A8` | upgrade |
| `smoke` | `#B7BEC9` | chimneys, steam |
| `coin` | `#FFD166` | tax income |
| `heart` | `#FF6B8A` | happiness gain |
| `leaf` | `#8FD97F` | ambience |

### UI

| Token | Hex |
|---|---|
| `uiInk` | `#171C26` |
| `uiPanel` | `#1E2530` |
| `uiPanel2` | `#262F3D` |
| `uiPanel3` | `#303B4B` |
| `uiLine` | `#35414F` |
| `uiText` | `#E8EDF5` |
| `uiMuted` | `#93A0B2` |
| `uiAccent` | `#4CD4A1` |
| `uiGold` | `#FFD166` |
| `uiRose` | `#FF6B8A` |
| `uiViolet` | `#9B8CFF` |
| `uiDanger` | `#FF5D6C` |

## 2. Tile metrics

| Quantity | Value | Note |
|---|---|---|
| Tile width | **64 px** | at zoom 1.0 |
| Tile height | **32 px** | 2:1 isometric |
| Sprite headroom | 96 px | above the tile diamond |
| Grid | 44 × 44 | 1,936 tiles, ~1,325 zoned after roads |
| Zoom range | 0.55× – 2.2× | eased, clamped to map bounds |
| World size | 2,816 × 1,408 px | before zoom |

Screen mapping (`render/terrain.js`):

```js
tileToScreen(x, y)   →  { sx: (x − y) × 32,  sy: (x + y) × 16 }
screenToTile(sx, sy) →  { x: (a + b) / 2,    y: (b − a) / 2 }
                        where a = sx / 32, b = sy / 16
```

**Painter's algorithm.** Buildings are sorted by `x + y` and drawn back to
front, so a tall tower behind a small house occludes it correctly with no depth
buffer. Multi-tile structures draw from their anchor (top-left) tile only.

## 3. Day/night cycle

| Clock | Phase | Light level | Notes |
|---|---|---|---|
| 0.00 | night | 0.08 | full window glow |
| 0.20 | night | 0.10 | lamps on |
| 0.25 | dawn | 0.35 | sky warms, glow fading |
| 0.35 | day | 0.85 | full colour |
| 0.50 | noon | 1.00 | peak |
| 0.70 | dusk | 0.75 | sky cools |
| 0.78 | dusk | 0.25 | lamps coming on |
| 0.85 | night | 0.10 | full glow again |

```js
lightLevel(clock)  = max(0.08, pow(0.5 + 0.5·cos((clock − 0.5)·2π), 0.72))
windowGlow(clock)  = clamp((0.72 − lightLevel) / 0.5, 0, 1)
nightAlpha(clock)  = (1 − lightLevel) × 0.62
```

The night pass is two operations: a **multiply** tint at `nightAlpha`, then an
**additive** radial glow around every lit structure at `0.30 × windowGlow`. The
shoulder on `windowGlow` means lamps come on slightly before it is truly dark and
stay on slightly after sunrise — the detail that makes the cycle feel physical
rather than like a slider.

One in-game day is 8 ticks ≈ 20 s at normal speed, so a full cycle is visible in
well under a minute.

## 4. Animation specifications

### Citizens

| Property | Value |
|---|---|
| Pool size | 220 (fixed, no allocation) |
| Spawn target | `min(220, pop × 0.35)` |
| Walk speed | 0.55 – 1.05 tiles/s |
| Bob amplitude | ±1.1 px |
| Cycle rate | 8 rad/s × speed |
| Body | 4.2 px radius circle + 2 px legs |
| Shadow | 2.4 × 1.2 px ellipse at 22% black |

Legs swing with `sin(phase)`, out of phase with each other. Pedestrians are
spawned from occupied residential tiles and wander toward commercial, park or
industrial tiles.

### Vehicles

| Property | Value |
|---|---|
| Pool size | 90 |
| Spawn target | `min(90, pop × 0.06) + 4` once 12+ road tiles |
| Speed | 2.2 – 3.8 tiles/s |
| Congestion effect | ×(1 − congestion × 0.55) |
| Body | 10.8 × 5.6 px rounded quad |
| Heading | rotated to face direction of travel |
| Headlights | additive, only at night |

Cars follow BFS paths over the carriageway graph and re-route on arrival. The
congestion term is what makes a gridlocked city *look* gridlocked.

### Particles

| Kind | Gravity | Life | Size | Colour |
|---|---|---|---|---|
| `dust` | +26 | 0.85 s | 1.5–3.4 px | `#C8B99A` |
| `spark` | −12 | 0.60 s | 1.0–2.2 px | `#FFE9A8` |
| `coin` | −34 | 1.10 s | 2.0–3.4 px | `#FFD166` |
| `heart` | −22 | 1.30 s | 2.0–3.6 px | `#FF6B8A` |
| `smoke` | −18 | 1.80 s | 2.4–5.0 px | `#B7BEC9` |
| `leaf` | +10 | 2.20 s | 1.4–2.6 px | `#8FD97F` |

Fixed pool of 320, one update pass, alpha falls as `1 − t²`. Construction emits
9 dust particles; an upgrade emits 12 sparks and 6 coins.

### UI transitions

| Element | Property | Duration | Easing |
|---|---|---|---|
| Toast in | opacity + translateY | 280 ms | `cubic-bezier(.22,.61,.36,1)` |
| Card open | opacity + scale | 300 ms | same |
| Inspector | opacity + translateX | 220 ms | same |
| Happiness meter | width | 500 ms | same |
| Palette hover | translateY −2px | 160 ms | same |
| Camera | position + zoom | per-frame easing, k = 1 − 0.0015^dt | — |

`prefers-reduced-motion` collapses every CSS transition to 0.01 ms, and the
in-game "Motion: reduced" setting disables the particle system entirely.

## 5. Sprite recipes

Each building is one draw function. The primitives are:

```js
isoBox({ w, h, depth, top, left, right })   // top diamond + two faces
pitchedRoof({ w, h, rise, color, ridge })   // two slanted quads + ridge line
windows({ cols, rows, lit, h, depth })      // grid on the right face
tree(x, y, scale, sway)                     // trunk + two leaf blobs
shadow(spread)                              // elliptical ground shadow
```

Tier progression is expressed as *footprint and silhouette change*, not just
scale — the single most important decision for making four tiers readable at a
glance:

| Zone | T1 | T2 | T3 | T4 |
|---|---|---|---|---|
| Residential | pitched-roof house, chimney | bigger house, 3×2 windows | flat-roof block, 3×3 windows | setback tower + antenna + red light |
| Commercial | striped awning, shopfront glazing | sign board, 3×2 windows | wide mall, 4×3 windows | glass curtain wall + aircraft light |
| Industrial | pitched shed | sawtooth roof | chimney + smoke plume | silo + gantry |
| Park | lawn, path, 2 trees, bench | +1 tree, lamp glow | +1 tree | +1 tree |
| Civic (2×2) | portico + pediment + clock | +flag | taller | taller |
| Stadium (2×2) | bowl + pitch | +floodlights | +crowd dots | +crowd dots |
| Power (2×2) | hall + 1 cooling tower + steam | +1 tower | +1 tower | +1 tower |

Night variants are not separate sprites: the same cached sprite is drawn with
`night: true`, which swaps window fills for `windowGlow` and adds lamp pools and
aircraft warning lights. Two cache entries per building instead of eight.

## 6. Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ● Micro Metropolis   ¤12,000  428/4000  ☺63  Day 12 summer  ⏸▶▶▶  ? ≡ │  top bar, 58px
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                                                    ┌────────┐│
│                     [ the city ]                   │inspector││  right, 272px
│                                                    └────────┘│
│  ┌──────────┐                                            ┌──┐│
│  │ treasury │                                            │  ││
│  └──────────┘                                            └──┘│
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Build [✕][I] │ [1][2][3][4]… │ [E][W][U][H]…   Tax Low/Normal/High  Coverage H/E/S/T/Off  Demand ▮▮▮ │  bottom, 104px
└──────────────────────────────────────────────────────────────┘
```

Panels use `rgba(30,37,48,.94)` with a 1 px `#35414F` border, a 14 px radius and
a two-layer shadow. The top and bottom bars fade to transparent at their inner
edge so the city is never boxed in.

## 7. Accessibility and robustness

- Text is `#E8EDF5` on `#1E2530` — roughly 12:1 contrast.
- Status is never colour-alone: every state also carries an icon or a word.
- Focus rings are preserved on all interactive elements.
- The canvas is labelled and the inspector is `aria-live="polite"`.
- All tooltips are real DOM nodes, so they are selectable and screen-readable.
- The game is fully playable with the keyboard (hotkeys, arrows to pan).
