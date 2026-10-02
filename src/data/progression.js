/**
 * progression.js — population milestones, unlocks and victory conditions.
 *
 * `unlockPop` in data/buildings.js gates the build palette; MILESTONES drives
 * the toast/announcement feed and the objective tracker in the top bar.
 */

export const MILESTONES = Object.freeze([
  { pop: 0, title: 'Foundation', text: 'Survey the land. Lay your first road.', reward: 'Starter grant' },
  { pop: 60, title: 'Hamlet', text: 'People are arriving. They need power and water.', reward: 'Power Plant + Water Tower' },
  { pop: 120, title: 'Village', text: 'Enough children to fill a classroom.', reward: 'School + Fire Station' },
  { pop: 400, title: 'Town', text: 'A real town needs a hospital and wide streets.', reward: 'Hospital + Boulevard' },
  { pop: 600, title: 'Borough', text: 'Industry is attracting attention - keep it safe.', reward: 'Police Station' },
  { pop: 900, title: 'City', text: 'Civic pride is worth investing in.', reward: 'Grand Plaza' },
  { pop: 1500, title: 'Metropolis', text: 'Time for a seat of government.', reward: 'Town Hall' },
  { pop: 2200, title: 'Green Shift', text: 'The smog is a talking point.', reward: 'Solar Farm' },
  { pop: 3000, title: 'Transit Age', text: 'Traffic is gridlocked. Go underground.', reward: 'Metro Station' },
  { pop: 3600, title: 'Cultural Capital', text: 'Your citizens want a place to gather.', reward: 'Stadium' },
]);

export const VICTORY = Object.freeze({
  /**
   * Population required to complete the campaign.
   *
   * The map is 44x44 with roughly 1,000 zoned tiles of headroom once roads
   * and services are accounted for. The reference player in
   * test/reference-player.js peaks at ~4,200 citizens, so 4,000 is a goal a
   * competent player reaches with room to spare and a careless one does not.
   */
  goalPop: 4000,
  /** Happiness that must hold at the moment the goal is reached. */
  goalHappiness: 68,
  /** Medals awarded for the end-of-run summary. */
  medals: [
    { id: 'green', label: 'Green City', text: 'Pollution under 18', test: (s) => s.pollution < 18 },
    { id: 'solvent', label: 'Solvent', text: 'Never took an emergency loan', test: (s) => !s.everEmergencyLoan },
    { id: 'beloved', label: 'Beloved', text: 'Happiness above 85 at the finish', test: (s) => s.happiness >= 85 },
    { id: 'swift', label: 'Swift', text: 'Reached the goal in under 120 in-game days', test: (s) => s.day <= 120 },
  ],
});

/** Binary search-free scan — the list is tiny. Returns the last reached row. */
export function currentMilestone(pop) {
  let m = MILESTONES[0];
  for (const row of MILESTONES) if (pop >= row.pop) m = row;
  return m;
}

export function nextMilestone(pop) {
  for (const row of MILESTONES) if (pop < row.pop) return row;
  return null;
}

export const TAX_LEVELS = Object.freeze([
  { id: 'low', label: 'Low', rate: 0.8, mood: +4, desc: 'Citizens love it, the treasury does not.' },
  { id: 'normal', label: 'Normal', rate: 1.0, mood: 0, desc: 'The balanced default.' },
  { id: 'high', label: 'High', rate: 1.25, mood: -7, desc: 'More revenue, visibly grumpier streets.' },
]);
