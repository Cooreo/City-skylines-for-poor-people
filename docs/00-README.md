# Micro Metropolis — Documentation Index

A small, charming city builder that runs entirely in the browser. No build step,
no backend, no binary assets: the repository root *is* the GitHub Pages site.

| Document | What it covers |
|---|---|
| [01 — Game Design](01-GAME-DESIGN.md) | Core loop, mechanics, balance tables, progression, events |
| [02 — Architecture](02-ARCHITECTURE.md) | File layout, module boundaries, the two clocks, data flow |
| [03 — Visual Style Guide](03-VISUAL-STYLE.md) | Palette (hex), tile metrics, animation specs, sprite recipes |
| [04 — Implementation Roadmap](04-ROADMAP.md) | Milestones M1–M5 with entry/exit criteria |
| [05 — Asset List](05-ASSETS.md) | Must-have vs nice-to-have, and why the list is short |

## Quick start

```bash
# play it
python3 -m http.server 8080      # then open http://localhost:8080

# test it (no browser needed)
npm test                         # 43 tests, ~10 seconds
node tools/balance-report.mjs    # prints the actual balance curve
```

The simulation is pure JavaScript over a plain state object, so the entire game
— growth, taxes, events, victory — runs headless in Node. That is what makes the
balance testable and the regression suite possible.

## Status

Everything in this blueprint is **implemented and tested**. The game is playable
at `index.html`. Milestone M5 (polish) is partially complete: the simulation,
rendering, UI, save system and event deck are done; remaining polish items are
listed in [04 — Implementation Roadmap](04-ROADMAP.md).
