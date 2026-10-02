# 02 — Architecture

## 1. Repository layout

The repository root **is** the deployable site. There is no `dist/`, no bundler
and no transpile step: `index.html` loads `src/app.js` as a native ES module and
the browser does the rest.

```
City-skylines-for-poor-people/
├── index.html                 entry point; loads src/app.js as a module
├── styles/
│   └── main.css               the entire UI, tokens mirror src/data/palette.js
├── src/
│   ├── app.js                 composition root: wires everything, owns rAF loop
│   ├── core/                  framework-free runtime
│   │   ├── game.js            the simulation orchestrator + the two clocks
│   │   ├── state.js           the single mutable world state + map generation
│   │   ├── eventbus.js        pub/sub; the only cross-layer channel
│   │   ├── rng.js             deterministic, serialisable mulberry32
│   │   └── save.js            localStorage persistence (RLE terrain, v3)
│   ├── data/                  pure data, no behaviour beyond small predicates
│   │   ├── palette.js         every colour in the game + colour helpers
│   │   ├── buildings.js       the build catalogue (17 entries)
│   │   ├── progression.js     milestones, unlocks, victory, tax levels
│   │   └── events.js          the event deck (17 cards)
│   ├── systems/               the simulation, one concern per file
│   │   ├── modifiers.js       timed numeric effects folded into a snapshot
│   │   ├── services.js        power/water rationing, coverage, pollution
│   │   ├── zoning.js          occupancy growth, tier ups, market demand
│   │   ├── population.js      headcount, employment, congestion
│   │   ├── happiness.js       per-zone mood → city aggregate
│   │   ├── economy.js         taxes, upkeep, treasury, loans, austerity
│   │   ├── eventsys.js        deck scheduling + the ctx handed to choices
│   │   ├── build.js           the ONLY way a building appears or disappears
│   │   ├── grid.js            tile geometry, road access, BFS pathfinding
│   │   ├── daynight.js        the calendar and the lighting curves
│   │   └── progression.js     unlock gates, milestones, victory
│   ├── render/                pure presentation; never mutates state
│   │   ├── renderer.js        the frame pipeline (11 passes)
│   │   ├── terrain.js         cached ground layer + animated waves
│   │   ├── sprites.js         procedural buildings, cached per (def,tier,variant)
│   │   ├── agents.js          pedestrians and vehicles
│   │   ├── particles.js       dust, sparks, coins, hearts, smoke
│   │   └── input.js           pointer, keyboard, touch, camera control
│   └── ui/                    DOM panels; no canvas
│       ├── dom.js             tiny element/format helpers
│       ├── panels.js          top bar, palette, inspector, budget, toasts
│       ├── cards.js           event cards, milestones, victory screen
│       └── menu.js            help, pause menu, save/load screen
├── test/
│   ├── sim.test.js            32 headless simulation tests
│   ├── boot.test.js           11 client-boot tests against a DOM stub
│   ├── reference-player.js    scripted "reasonable player" used as the balance bar
│   └── dom-stub.js            minimal DOM + Canvas2D shim for CI
├── tools/
│   └── balance-report.mjs     prints the actual balance curve
├── docs/                      this documentation
└── .github/workflows/         test.yml + deploy.yml (GitHub Pages)
```

## 2. Module boundaries

The dependency arrow points **inward only**:

```
        ui/  ──┐
              ├──►  app.js  ──►  systems/  ──►  data/
   render/ ──┘         │              │
                       └──────────────┴──►  core/
```

- `data/` imports nothing.
- `core/` imports `data/` only for defaults.
- `systems/` imports `core/` and `data/`. **Never** `ui/` or `render/`.
- `render/` and `ui/` import `core/`, `data/` and `systems/`, never each other.
- `app.js` is the only file that knows about both the DOM and the simulation.

This is enforced by inspection and by the headless test suite: `sim.test.js`
imports the whole simulation and runs it in Node with no DOM present at all.

## 3. State

One plain-object tree, no classes, no getters, no hidden ownership:

```js
state = {
  version, seed, rngState,
  tick, day, clock, season, speed,
  grid:   { w, h, terrain: Int8Array, height: Float32Array, buildings: Array },
  camera: { x, y, zoom, tx, ty, tzoom },
  starter:{ x, y, size },          // guaranteed-clear opening plot
  center: { x, y },
  economy:{ cash, income, expense, net, taxLevel, loans, history, … },
  city:   { pop, jobs, happiness, zoneHappiness, pollution, congestion,
            powerRatio, waterRatio, coverage, demand, zoneCounts, … },
  modifiers: [],                   // timed effects
  unlocked: [], seenMilestones: [],
  deck:   { cooldowns, lastFired, active, history },
  stats:  { built, demolished, eventsResolved, bestPop, bestHappiness },
  settings:{ showGrid, showCoverage, reduceMotion, autoSave },
  selection, tool, hover,
  dirty:  { terrain, sprites },
  bus, rng,                        // transient, never saved
}
```

**Derived values are never saved.** `city.pop`, coverage maps and agent pools are
recomputed on the first tick after a load. That keeps saves at 6–10 kB and makes
them resilient to balance changes.

## 4. The two clocks

This is the central architectural decision.

| | Visual clock | Simulation tick |
|---|---|---|
| Driven by | `requestAnimationFrame` | fixed accumulator |
| Rate | continuous, `dt` seconds | every 2.5 s (÷ speed) |
| Owns | sun position, window glow, walk cycles, car motion, particles | occupancy, taxes, happiness, events |
| Affects | nothing in `state` except `camera` | everything in `state` |

The sun glides because it reads `clock.clock`, which advances every frame.
Population moves in steps because it is only recomputed on a tick. The result is
a game that looks like 60 fps and simulates like a spreadsheet.

`game.update(dt)` returns the number of ticks that ran — usually zero. The frame
loop caps catch-up at 4 ticks so a backgrounded tab does not fast-forward the
city on return.

## 5. Tick order

Order matters and is the one thing not to reorder casually:

```
 1  modifiers    fold timed effects into a snapshot the rest can read
 2  services     power/water rationing + coverage + pollution maps
 3  zoning       occupancy moves toward pressure (reads last tick's demand)
 4  population   derive pop, jobs, congestion
 5  demand       recompute market demand from the new numbers
 6  happiness    per-zone mood → city aggregate
 7  economy      tax the result, pay the upkeep
 8  events       maybe open a card
 9  progression  unlocks, milestones, victory
```

Zoning runs *before* population because occupancy is the input to headcount.
Demand runs *after* population because the market reacts to what just happened.
Happiness runs after demand so it sees the current picture.

## 6. The event bus

`core/eventbus.js` is the only cross-layer channel. Systems emit; UI and the
renderer subscribe. Nothing in `systems/` knows the UI exists.

```js
EV.TICK, EV.STATE, EV.CASH, EV.BUILD, EV.DEMOLISH, EV.SELECTION, EV.TOOL,
EV.MILESTONE, EV.EVENT_SHOW, EV.EVENT_RESOLVE, EV.TOAST, EV.UNLOCK,
EV.VICTORY, EV.SAVE, EV.LOAD, EV.ZOOM, EV.SPEED
```

Handlers are wrapped in `try/catch` so one broken listener cannot kill the game
— but that also means a wiring bug fails *silently*, which is exactly how
`app.toasts` vs `app.ui.toasts` survived until the boot tests caught it. The
lesson is encoded in `test/boot.test.js`: the whole client boots and renders
under a DOM stub, so wiring mistakes surface as test failures rather than as a
game that quietly stops showing toasts.

## 7. Rendering pipeline

`render/renderer.js` runs eleven passes per frame:

| # | Pass | Notes |
|---|---|---|
| 1 | sky gradient | from `daynight.skyColors(clock)` |
| 2 | ground | **one `drawImage`** of the cached terrain canvas |
| 3 | water waves | animated foam highlights over static water |
| 4 | coverage overlay | service tint, only when enabled |
| 5 | buildings | painter's algorithm, sorted by `x + y` |
| 6 | grid | debug |
| 7 | build ghost | placement preview, green/red |
| 8 | hover + selection | tile highlight, marching-ants reticle |
| 9 | agents | pedestrians and vehicles |
| 10 | particles | dust, sparks, coins, hearts |
| 11 | night pass | multiply tint + additive window/lamp glow |

The ground is the reason this holds 60 fps on a 44×44 map: 1,936 tiles of
procedural art are drawn **once** into an offscreen canvas and invalidated only
when the player bulldozes forest or rock. Buildings are cached per
`(def, tier, variant, night)` in `sprites.js`, so a city of 300 structures costs
300 `drawImage` calls and zero path work.

## 8. Procedural art

There are **no binary assets**. Every building is drawn by a small function in
`render/sprites.js` into an offscreen canvas:

```js
const DRAW = {
  road: drawRoad, residential: drawResidential, commercial: drawCommercial,
  industrial: drawIndustrial, park: drawPark, plaza: drawPlaza,
  civic: drawCivic, stadium: drawStadium, power: drawPower, solar: drawSolar,
  water: drawWaterTower, school: drawSchool, hospital: drawHospital,
  fire: drawFire, police: drawPolice, subway: drawSubway, tool: drawTool,
};
```

Seventeen buildings × four tiers × three variants would be ~200 hand-drawn
sprites. Procedural gets the same variety from ~40 draw functions, and a new
building or a rebalance needs no art pass. The trade-off is that the art is
geometric rather than painterly — which suits the "Mini Metro meets Stardew"
brief.

## 9. Save format (v3)

```jsonc
{
  "v": 3,
  "seed": 1337, "rngState": 872347,
  "tick": 412, "day": 52, "clock": 0.41, "season": "summer", "speed": 1,
  "economy": { "cash": 8420, "taxLevel": "normal", "loans": [], … },
  "grid": {
    "w": 44, "h": 44,
    "terrain": [[0,214],[1,32],[2,18], …],     // run-length encoded
    "buildings": [[1234,"residential",2,1,0.87,1,0,0,401], …]
  },
  "unlocked": […], "seenMilestones": […], "deck": { … },
  "modifiers": […], "stats": { … }, "settings": { … }
}
```

Terrain is RLE-encoded (a 44×44 map collapses to ~60 runs) and buildings are a
sparse tuple array. A mid-game save is 6–10 kB. An open event card is never
persisted; the deck resumes on the next tick.

Loading is defensive: unknown building ids from an older build are dropped, a
map-size mismatch regenerates terrain while keeping the buildings that fit, and
a corrupt file throws rather than corrupting the session.

## 10. Testing strategy

| Suite | What it proves | How |
|---|---|---|
| `sim.test.js` (32) | the game is *balanced* and *stable* | runs thousands of ticks in Node |
| `boot.test.js` (15) | the client *boots and renders* | real `app.js` against a DOM stub |
| `reference-player.js` | the goal is *reachable* | scripted competent play |
| `balance-report.mjs` | the numbers in the docs are *true* | prints the measured curve |

The headless suite caught four bugs that no screenshot would have revealed:

1. Emergency loans compounding to 1e17.
2. Austerity mothballing the water tower.
3. Multi-tile demolition leaving orphaned tiles that still supplied power.
4. An unbounded per-zone unemployment penalty collapsing happiness to zero.
5. `ctx.rng` handed to event choices was the rng *object*, not a function, so
   every "patch and pray" choice threw.
6. Multi-tile buildings drew centred on their anchor tile rather than their
   footprint.

```bash
npm test                          # 47 tests, ~15 seconds
node tools/balance-report.mjs     # the balance curve
```
