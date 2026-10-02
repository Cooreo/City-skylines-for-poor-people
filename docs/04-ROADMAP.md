# 04 — Implementation Roadmap

Five milestones. Each has an entry criterion, the work, an exit criterion you can
actually check, and the honest risk. Status is accurate as of this commit.

---

## M1 — Protducible prototype ✅ **complete**

**Goal:** prove the core loop is fun with grey boxes.

**Work**
- Isometric grid, tile picking, camera pan/zoom.
- Road placement with drag-to-draw.
- Zone placement, occupancy growth, four tiers.
- Power and water as simple ratios.
- Tax income, upkeep, a cash number.
- A tick loop at 2.5 s.

**Exit criteria — all met**
- [x] Place roads and zones, watch population rise over ~10 ticks.
- [x] A building with no road stays empty.
- [x] Cash goes down when you build and up when citizens arrive.
- [x] The whole thing runs in a browser from a static file.

**Risk that materialised:** the first demand model was *coupled* — residential
demand fed off jobs, jobs fed off commercial occupancy, commercial occupancy fed
off population — and the whole thing collapsed to zero within 20 ticks. Fixed by
making each RCI channel independently driven (§ M3).

---

## M2 — Art pass ✅ **complete**

**Goal:** make it look like the reference tone, with zero binary assets.

**Work**
- Procedural sprite system with an offscreen cache.
- 17 buildings × 4 tiers × 3 variants.
- Terrain: grass, sand, water, rock, forest, with a river and an island falloff.
- Day/night cycle with lit windows and lamp glow.
- Soft shadows and the painter's algorithm.

**Exit criteria — all met**
- [x] Four visually distinct tiers per zone, readable at a glance.
- [x] A full day/night cycle in under a minute of play.
- [x] 60 fps with ~300 buildings (measured: 43 draw calls/frame cached).
- [x] No binary files in the repository — enforced in CI.

**Note on approach:** hand-drawing 4 tiers × 17 buildings × 3 variants is ~200
assets. Procedural drawing gets the same variety from ~40 functions and survives
rebalancing without an art pass. The trade-off is a geometric rather than
painterly look, which suits the brief.

---

## M3 — Simulation depth ✅ **complete**

**Goal:** the numbers have to mean something.

**Work**
- Happiness per zone with a legible breakdown.
- Service coverage radii for health, education, safety, transit.
- Pollution from industry, spread over a radius.
- Congestion from population and jobs, relieved by metro coverage.
- Employment and unemployment.
- 17 event cards with real trade-offs.
- Milestone unlocks and the victory condition.

**Exit criteria — all met**
- [x] Every happiness number can be explained to the player (the inspector
      shows the active effects; the budget panel shows coverage percentages).
- [x] Events change what the player should do next, not just a cash number.
- [x] The reference player reaches the victory goal — the balance bar.

**Risk that materialised:** three balance bugs, all invisible without a headless
harness.

1. *Compounding loans.* Proportional emergency loans overflow to 1e17.
2. *Austerity removed the water tower*, which can never be recovered from.
3. *Unbounded per-zone unemployment penalty* collapsed happiness to zero, which
   closed the demand gate and made a slow start unrecoverable.

Each is now a regression test in `test/sim.test.js`.

---

## M4 — UI and feel ✅ **complete**

**Goal:** a modern, clean interface with real feedback.

**Work**
- Top bar (cash, population, happiness, date, speed).
- Build palette with lock states, costs, hotkeys and demand indicators.
- Right-side inspector with occupancy meters, service rows, upgrade/bulldoze.
- Treasury panel with income/expense breakdown and debt.
- Event cards, milestone banners, victory screen with medals.
- Styled tooltips replacing native `title`.
- Toasts, hover states, smooth transitions.
- Save/load with four slots and an autosave.
- Keyboard and touch support.

**Exit criteria — all met**
- [x] Every action gives feedback within one frame.
- [x] The player can always tell *why* a number is what it is.
- [x] Saves round-trip; a corrupt save is rejected, not fatal.
- [x] The whole client boots and renders under a DOM stub in CI.
- [x] A 2,400-tick session through the real UI runs with zero console errors.

**Risk that materialised:** a wiring bug (`app.toasts` vs `app.ui.toasts`) was
swallowed by the bus's error handling, so toasts silently stopped working.
`test/boot.test.js` now boots the real composition root, which catches exactly
this class of mistake.

---

## M5 — Polish and ship 🔄 **in progress**

**Goal:** the last 10% that makes it feel finished.

**Done**
- [x] 47 automated tests (32 simulation + 15 boot), including a full
      2,400-tick session driven through the real UI.
- [x] Balance report tool; the docs quote measured numbers.
- [x] GitHub Pages deploy workflow.
- [x] `prefers-reduced-motion` support and an in-game motion toggle.
- [x] Full documentation set.

**Remaining**
- [ ] **Sound.** A small set of procedural WebAudio blips (place, demolish,
      coin, event chime, tier-up). Must be mutable and off by default until the
      player interacts, to respect autoplay policy. ~1 day.
- [ ] **Ambient life.** Birds at dawn, crickets at night, leaves drifting.
      Purely cosmetic, gated behind `reduceMotion`. ~half a day.
- [ ] **Onboarding.** A three-step guided intro ("place a road", "zone some
      housing", "build a power plant") that dismisses itself. ~1 day.
- [ ] **Tutorial tooltips** on the first tick of each new unlock. ~half a day.
- [ ] **Mobile layout pass.** Touch works; the layout is desktop-first. A
      dedicated compact palette and a bottom-sheet inspector. ~1 day.
- [ ] **Colour-blind mode.** Alternative zone palette using shape + pattern
      rather than hue alone. ~half a day.
- [ ] **Accessibility audit.** Full keyboard traversal, focus trapping in
      modals, screen-reader labels on the canvas. ~1 day.
- [ ] **Performance budget CI.** A test that asserts frame cost stays under
      budget as the city grows. ~half a day.
- [ ] **Analytics-free telemetry** — no. Explicitly out of scope.

**Ship checklist**
- [x] `npm test` green.
- [x] `node tools/balance-report.mjs` shows a healthy curve.
- [x] No binary assets committed.
- [x] README explains how to run it.
- [x] Deploy workflow pushes the repo root to Pages.
- [ ] Playtest with five people who have never seen it.

---

## Sequencing advice

If you are picking this up fresh, do it in this order:

1. **M1 and M2 first, together.** They are the same work: you cannot judge
   whether zoning feels good through grey boxes, and you cannot judge art
   without something moving.
2. **M3 before M4.** Building UI on top of numbers that later change is wasted
   UI. Get the simulation stable and *tested*, then dress it.
3. **M4 before M5.** Polish on a broken interface is invisible.
4. **Never skip the headless harness.** It is the only reason the balance
   numbers in `docs/01-GAME-DESIGN.md` are trustworthy, and it caught four bugs
   that would each have shipped.

## Estimated totals

| Milestone | Effort | Status |
|---|---|---|
| M1 Prototype | 3–4 days | ✅ |
| M2 Art pass | 4–5 days | ✅ |
| M3 Simulation depth | 5–7 days | ✅ |
| M4 UI and feel | 4–5 days | ✅ |
| M5 Polish | 5–6 days | 🔄 ~40% |
| **Total** | **21–27 days** | |
