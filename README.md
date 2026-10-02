# Micro Metropolis

A small, charming city builder that runs entirely in your browser.

Start with an empty island and a modest grant. Lay roads, zone housing, shops
and industry, keep the lights on and the water running, and grow to four
thousand citizens who are genuinely happy to live there. Random events arrive as
cards you have to resolve. The whole run takes 30–60 minutes.

**No build step. No backend. No binary assets.** The repository root *is* the
GitHub Pages site — `index.html` loads native ES modules and the browser does
the rest. Every building, citizen and car is drawn procedurally into a canvas.

### [▶ Play it in your browser](https://cooreo.github.io/City-skylines-for-poor-people/)

Or serve the repository root yourself:

```bash
npm test                      # 47 tests in ~15s, no browser needed
python3 -m http.server 8080   # then open http://localhost:8080
node tools/balance-report.mjs # print the actual balance curve
```

## What is here

| | |
|---|---|
| **Simulation** | 12 systems in `src/systems/`: zoning, services, population, happiness, economy, events, progression, day/night, build, grid, modifiers |
| **Rendering** | `src/render/`: 11-pass frame pipeline, procedural sprites, terrain cache, animated agents, particles |
| **UI** | `src/ui/`: top bar, build palette, inspector, treasury panel, event cards, victory screen |
| **Events** | 17 unique cards, each with 2–3 real choices |
| **Persistence** | 4 save slots + autosave, RLE-encoded terrain, 6–10 kB per save |
| **Tests** | 32 headless simulation tests + 15 client-boot tests |
| **Docs** | [Game design](docs/01-GAME-DESIGN.md) · [Architecture](docs/02-ARCHITECTURE.md) · [Visual style](docs/03-VISUAL-STYLE.md) · [Roadmap](docs/04-ROADMAP.md) · [Assets](docs/05-ASSETS.md) |

## The two clocks

The central architectural decision. The **simulation** ticks every 2.5 seconds
and owns every number. The **render** clock runs every animation frame and owns
everything that moves smoothly. The sun glides; population steps.

```js
// src/core/game.js
function update(dt) {
  daynight.advance(clock, dt, world.speed);   // visual clock: every frame
  const interval = TICK_SECONDS / SPEED[world.speed];
  accumulator += dt;
  while (accumulator >= interval && ran < MAX_CATCHUP) { tick(); ran++; }
  return ran;                                  // usually 0
}
```

That is why the game looks like 60 fps and simulates like a spreadsheet — and
why the entire simulation runs headless in Node with no DOM.

## Sample code

### The game loop (tick order matters)

```js
function tick() {
  if (eventsys.isBlocked(world)) return;          // a card is open

  modifiers.decayModifiers(world);
  modifiers.snapshot(mods, world);                 // 1. fold timed effects

  services.update(world, mods);                    // 2. ration power & water
  zoning.update(world, mods, rng, bus);            // 3. occupancy moves
  population.update(world, mods);                  // 4. derive headcount
  zoning.computeDemand(world, mods);               // 5. market reacts
  happiness.update(world, mods);                   // 6. per-zone mood
  economy.update(world, mods);                     // 7. tax and pay upkeep
  economy.enforceFloor(world, bus);                //    never dead-end

  world.tick++;
  eventsys.update(world, rng, bus);                // 8. maybe open a card
  progression.update(world, bus);                  // 9. unlocks & victory
}
```

### The render loop

```js
// src/app.js
frame(now) {
  const dt = Math.min(0.1, (now - this._lastFrame) / 1000);
  this.game.update(dt);                 // simulation, usually 0 ticks
  this.agents.update(dt);               // citizens and cars
  this.particles.update(dt);            // dust, sparks, coins
  this.renderer.updateCamera(dt);       // eased, clamped to map
  this.renderer.render(dt);             // 11 passes, one drawImage for ground
  requestAnimationFrame((t) => this.frame(t));
}
```

### One full system: the economy

```js
// src/systems/economy.js (abridged)
export const RATES = { residential: 0.10, commercial: 0.22, industrial: 0.16, roadPerTile: 0.02 };

export function update(state, mods) {
  const edu = 1 + Math.min(0.28, state.city.coverage.education * 0.35);
  const income =
      state.city.pop             * RATES.residential * tax * edu * civic
    + state.city.commercialJobs  * RATES.commercial  * tax * edu * civic * mods.productivity
    + state.city.industrialJobs  * RATES.industrial  * tax * edu * civic * mods.productivity;

  // Zoned upkeep scales with occupancy: an empty lot is cheap, so over-zoning
  // is a bet rather than a penalty.
  let upkeep = 0;
  for (const b of state.grid.buildings) {
    if (!b || !getDef(b.def)?.upkeep) continue;
    const zoned = ['residential','commercial','industrial','park'].includes(getDef(b.def).zone);
    upkeep += getDef(b.def).upkeep * TIERS.UPKEEP[b.tier - 1]
            * (zoned ? 0.18 + (b.occ || 0) * 0.82 : 1);
  }

  transfer(state, income - upkeep, 'taxes');
}
```

## Balance

The numbers in the docs are measured, not remembered. `tools/balance-report.mjs`
runs a scripted "reasonable player" for 4,000 ticks and prints the curve:

```
day   pop   happy  cash      net     pow  wat  cong  unemp  demand(R/C/I)
 32  3887    73     63200    1073  100  100    39     3  100/100/ 36
 34  4001    72     77612    1062  100  100    30     5  100/ 97/ 39
 *** VICTORY on day 34
```

The headless tests then assert on the *shape* of that curve: a lot with roads,
power and water must fill and tier up; a lot without a road must stay empty; a
single water tower must ration coherently rather than flicker; the reference
player must reach the goal. Four real bugs were caught this way — compounding
loans, austerity closing the water tower, orphaned multi-tile footprints, and an
unemployment penalty that collapsed happiness to zero.

## Controls

| | |
|---|---|
| Build | pick from the palette, click a tile; drag for roads and zones |
| Inspect | `I`, then click anything |
| Bulldoze | `X` |
| Pan | right-drag, or `WASD` / arrows |
| Zoom | scroll, or pinch |
| Speed | `Space` pause, `+` / `-` |
| Zones | `1` housing · `2` shops · `3` industry · `4` park |
| Services | `E` power · `W` water · `U` school · `H` hospital · `F` fire · `G` police · `M` metro |
| Other | `R` road · `B` boulevard · `P` plaza · `T` town hall · `S` stadium · `L` solar · `H` help |

## Deploying

Push to `main`; `.github/workflows/deploy.yml` uploads the repository root as a
Pages artifact. There is nothing to build.

To host it yourself, serve the directory with any static file server. Opening
`index.html` over `file://` will not work, because ES modules are blocked by the
file origin — use a local server.

## Licence

MIT.
