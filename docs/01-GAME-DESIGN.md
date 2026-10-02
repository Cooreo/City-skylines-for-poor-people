# 01 — Game Design Document

## 1. Fantasy

You are the founding mayor of a small island. You start with empty land and a
modest grant, and you finish with a metropolis of four thousand people who are
genuinely happy to live there. The whole run takes 30–60 minutes.

The tone is warm and slightly wry. Nothing is apocalyptic. The worst thing that
happens is that the auditor is disappointed in you.

## 2. Core loop

```
  place roads & zones
        │
        ▼
  ┌──────────────┐     every 2.5 s      ┌─────────────────┐
  │   TICK       │ ───────────────────► │ population grows│
  │  (9 systems, │                      │ taxes collected │
  │   in order)  │ ◄─────────────────── │ expenses paid   │
  └──────────────┘     read back        └─────────────────┘
        │                                        │
        ▼                                        ▼
  random event card  ◄───────────────    happiness recalculated
  (simulation halts                        per zone, aggregated
   while it is open)                       city-wide
        │
        ▼
  unlock new buildings at population milestones
```

A tick is 2.5 seconds of wall time at normal speed. Everything the player sees
move smoothly — the sun, the citizens, the cars — is driven by the *render*
clock, not the sim clock. See [02 — Architecture](02-ARCHITECTURE.md) §The two
clocks.

## 3. Mechanics

### 3.1 Zoning is not building

The player places an **empty lot** and the simulation decides how full it gets
and how tall it grows. Occupancy (`0…1`) is the only state variable:

```
pressure = access                                  0 or 1
         × utilities                               power & water rationing
         × ((demand + localMood) / 2) × 1.6        market + neighbourhood
occupancy += (pressure − occupancy) × 0.2          growth
occupancy += (pressure − occupancy) × 0.09         decay
```

Four tiers, unlocked by *sustained* fullness rather than by payment:

| Tier | Trigger | Capacity × | Upkeep × | Looks like |
|---|---|---|---|---|
| 1 | placed | 1.0 | 1.0 | small house / kiosk / workshop |
| 2 | ≥80% full for 3 ticks | 1.8 | 1.9 | larger house / shopfront / sawtooth shed |
| 3 | same again | 3.1 | 3.2 | low apartment / mall / chimney works |
| 4 | same again | 5.0 | 5.2 | tower with setback / glass office / refinery |

Because occupancy is the only lever, every other system — a blackout, a flood, a
bad mood, a deficit — moves the population number automatically. There is no
special case for "the power went out"; the lots simply empty.

### 3.2 Roads and access

A building must sit within **one tile** of a carriageway or it never fills. The
access map is recomputed once per tick into a `Uint8Array`, so the check is O(1)
for every lot. Road upkeep is ¤0.02/tile/tick — deliberately cheap, because
roads are infrastructure, not a tax.

### 3.3 Services and rationing

Power and water are pooled city-wide. When demand exceeds supply, buildings are
served in a **stable** order (a spatial hash), so the same district stays dark
rather than flickering. Rationing is legible: you can see which part of town is
short.

Health, education, safety and transit are radius services:

| Service | Building | Radius | Capacity | Effect |
|---|---|---|---|---|
| Power | Power Plant | city-wide | 90 × tier | gate on all growth |
| Power | Solar Farm | city-wide | 70 × tier | same, no pollution |
| Water | Water Tower | city-wide | 70 × tier | gate on all growth |
| Education | School | 7 | 60 × tier | +6 mood, +35% tax yield |
| Health | Hospital | 9 | 120 × tier | +7 mood, halves event damage |
| Safety | Fire Station | 6 | — | prevents fire losses |
| Safety | Police Station | 7 | — | +6 mood, crime |
| Transit | Metro Station | 6 | — | −45% congestion in radius |
| Mood | Park | 3 | — | +6 mood |
| Mood | Grand Plaza | 5 | — | +12 mood |
| Mood | Town Hall | 6 | — | +9 mood, +4%/tier tax |
| Mood | Stadium | 8 | — | +16 mood |

Coverage is reported per zone in the budget panel, and can be visualised as a
tile tint from the palette.

### 3.4 Happiness

Computed per zone, then blended 60% residential / 25% commercial / 15%
industrial and smoothed with an EMA (α = 0.28) so the meter glides instead of
twitching.

Per-tile score (residential example):

```
 52  base
+14  parks, plazas, civic mood radius
 +7  health cover        −4  no health cover
 +6  schools             −2  no schools
 +6  safety              −3  no safety
+16  air quality (negative term)
−10  congestion (scaled)
−18  no power
−14  no water
 −7  unemployment above 15% (residential only, workforce-weighted)
```

Two deliberate softnesses:

- **Unemployment is workforce-weighted.** A hamlet of eight is not a labour
  market; the penalty scales with `min(1, workingAge / 40)`. Without this, the
  very first housing lot drives happiness to zero and the player cannot start.
- **The demand gate has a floor.** Happiness opens the growth gates via
  `(happiness − 12) / 52`, and residential demand has a `0.26` baseline. A
  miserable city grows *slowly*; it does not stop dead. A hard zero-growth gate
  makes a bad early economy unrecoverable, which reads as a bug.

### 3.5 Economy

Tax rates, ¤ per tick:

| Source | Rate |
|---|---|
| Residential | 0.10 × resident |
| Commercial | 0.22 × job |
| Industrial | 0.16 × job |

Modifiers: education coverage adds up to +28% yield, a Town Hall adds +4% per
tier (capped at +60%), and the tax level scales everything.

**Zoned upkeep scales with occupancy** (`0.18 + occupancy × 0.82`). This is the
single most important balance decision in the game: a flat per-tile cost means a
player who zones generously is punished *before the citizens arrive*, and a slow
start becomes unrecoverable. With the occupancy term, over-zoning is a bet
rather than a penalty.

Per-structure economics at full occupancy, tier 1:

| Structure | Income | Upkeep | Net |
|---|---|---|---|
| Housing | 0.80 | 0.30 | **+0.50** |
| Shops | 1.32 | 0.40 | **+0.92** |
| Industry | 1.28 | 0.50 | **+0.78** |
| Power Plant | — | 3.00 | −3.00 (enables growth) |
| Water Tower | — | 1.00 | −1.00 (enables growth) |
| School | — | 1.50 | −1.50 (enables growth) |
| Hospital | — | 3.50 | −3.50 (enables growth) |
| Fire Station | — | 1.40 | −1.40 (enables growth) |
| Police Station | — | 1.60 | −1.60 (enables growth) |
| Road tile | — | 0.02 | — |

Every service costs money and pays for itself only through the growth it
enables. That is the intended tension: you cannot see the return on a hospital
in its own ledger.

### 3.6 Deficit handling

A deficit is a **soft fail state**, never a dead end:

1. Happiness decays (−2/tick escalating to −12).
2. Growth stalls because the demand gate closes.
3. When cash would go below zero, a **fixed ¤1,500 emergency tranche** is taken,
   at most one per 6 ticks, at most 4 outstanding. Interest is 0.6%/tick.
4. Past the credit limit, the treasury **mothballs its most expensive optional
   service** (stadium → plaza → town hall → metro → hospital → school → police
   → fire). Power and water are never mothballed: closing the grid collapses
   occupancy, which collapses income, which can never recover.

Two bugs this design specifically avoids, both found by the headless tests:

- **Compounding loans.** A proportional emergency loan (`shortfall × 1.15`)
  turns into an exponential: interest deepens the hole, the next loan is bigger,
  and within 300 ticks the treasury overflows to 1e17. Fixed tranches make the
  penalty a real, bounded number.
- **Partial demolition.** Removing one tile of a 2×2 building leaves orphans
  that still supply power, still charge upkeep and still block placement. Every
  removal path goes through `removeInstance()`, which clears the footprint.

### 3.7 Random events

Seventeen cards. At most one is open at a time; the simulation halts while it
is. Each card has a `requires()` predicate, so a brand-new settlement never sees
a rent protest, and its own cooldown.

| Event | Trigger | Choices |
|---|---|---|
| Heatwave | pop > 150, summer | cooling centres / rationing / nothing |
| Tourism Boom | pop > 200, 2+ parks | welcome / cap numbers |
| Infrastructure Failure | 20+ roads | emergency repairs / close segment / patch and pray |
| Factory Fire | any industry | full response / let it burn |
| Flu Season | pop > 300 | vaccination drive / ride it out |
| Tech Investor | pop > 700, school | red carpet / standard terms / decline |
| Rent Protest | pop > 250, tax ≠ low | cut taxes / fund housing / hold the line |
| Street Festival | pop > 180 | permit everything / one parade |
| Brownout | power ratio < 1 | rotating blackouts / generator hire |
| River Flood | autumn or winter | sandbag / evacuate |
| Crime Wave | pop > 400 | community patrols / street lighting |
| Federal Grant | always | take the cash / match with a park |
| Transit Strike | 2+ industry | meet terms / wait them out |
| Smog Alert | pollution > 22 | emission curfew / issue masks |
| Livability Award | happiness > 74, pop > 500 | host ceremony / press release |
| Sinkhole | 12+ roads | fill and repave / fence it off |
| Treasury Crisis | cash < 400 or deficit | emergency loan / austerity / max taxes |

Every choice is a real trade with a visible consequence, and several are gated
on city state ("no station in range — the block is gone").

### 3.8 Progression

| Pop | Milestone | Unlock |
|---|---|---|
| 0 | Foundation | roads, zones, power plant, water tower |
| 60 | Hamlet | — |
| 120 | Village | School, Fire Station |
| 400 | Town | Hospital, Boulevard |
| 600 | Borough | Police Station |
| 900 | City | Grand Plaza |
| 1200 | — | Town Hall |
| 2200 | Green Shift | Solar Farm |
| 3000 | Transit Age | Metro Station |
| 3600 | Cultural Capital | Stadium |

**Victory: 4,000 citizens at ≥68% happiness.**

The goal is calibrated against the scripted reference player in
`test/reference-player.js`, which reliably finishes around day 34 at ~4,000.
The map has ~1,325 zoned tiles of headroom once roads are accounted for, so
4,000 is a goal a competent player reaches with room to spare and a careless one
does not. Four medals are awarded at the finish: Green City (pollution < 18),
Solvent (never took an emergency loan), Beloved (happiness ≥ 85), Swift
(under 120 days).

## 4. Time and pacing

| Quantity | Value |
|---|---|
| Tick length (speed 1) | 2.5 s |
| Ticks per in-game day | 8 |
| In-game day at speed 1 | 20 s |
| Season length | 12 days |
| Speeds | paused / 1× / 2.4× / 4.5× |
| Max catch-up per frame | 4 ticks |

A full run is roughly 30–60 minutes at normal speed, or 10–15 minutes if the
player leans on the fast-forward.

## 5. Balance methodology

Every number above is measured, not guessed. `tools/balance-report.mjs` runs the
reference player for 4,000 ticks and prints the curve:

```bash
node tools/balance-report.mjs
```

The test suite then asserts on the *shape* of that curve: a lot with roads,
power and water must fill and tier up; a lot without a road must stay empty; a
single water tower must ration coherently rather than flicker; the reference
player must grow a city. If a rate change breaks the game, these tests fail
before a human ever sees it.
