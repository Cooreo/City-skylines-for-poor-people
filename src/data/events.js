/**
 * events.js — the random-event deck (16 cards).
 *
 * An event is pure data plus small pure functions. `requires(ctx)` decides
 * eligibility, `choices[].run(ctx)` performs the mutation and returns the
 * string shown in the resolution toast.
 *
 * The `ctx` API (implemented in systems/eventsys.js):
 *   ctx.state            read-only snapshot helpers (pop, happiness, cash, …)
 *   ctx.cash(n)          add/subtract money
 *   ctx.mood(n, ticks)   flat happiness modifier for a duration
 *   ctx.mod(key, v, t)   named numeric modifier, e.g. ('taxRate', 1.2, 40)
 *   ctx.demand(zone, v, ticks)
 *   ctx.countBuilding(id)
 *   ctx.affected(defId)  list of placed instances of a building type
 *   ctx.hasService(key)  true if the city provides the service at all
 *   ctx.coveredRatio(key) 0..1 of zoned tiles inside the service radius
 *   ctx.spawn(defId)     place a free building on a random legal tile
 *   ctx.loan(amount)     borrow from the treasury (adds interest upkeep)
 *   ctx.destroyRandom(defId, n, requireCoverageKey?)
 *   ctx.rng              seeded RNG (deterministic replays / saves)
 */

const day = 8; // ticks per in-game day, see core/game.js TIME

export const EVENTS = Object.freeze([
  {
    id: 'heatwave',
    title: 'Heatwave',
    icon: 'sun',
    blurb: 'Three weeks above 38°C. The reservoir is dropping and the pavement is soft.',
    weight: 10,
    cooldown: 30 * day,
    requires: (c) => c.state.pop > 150 && c.state.season === 'summer',
    choices: [
      {
        label: 'Open cooling centres',
        hint: '-¤300 now, small mood dip',
        run: (c) => { c.cash(-300); c.mood(-4, 12 * day); return 'Cots and cold water kept the worst away.'; },
      },
      {
        label: 'Mandatory water rationing',
        hint: 'Free, residents unhappy',
        run: (c) => { c.mood(-12, 8 * day); return 'Lawns died. So did the goodwill.'; },
      },
      {
        label: 'Do nothing',
        hint: 'Hospitals strained',
        run: (c) => {
          const strain = c.hasService('health') ? -8 : -18;
          c.mood(strain, 14 * day);
          return strain < -10 ? 'Without a hospital it became a crisis.' : 'The hospital absorbed the strain.';
        },
      },
    ],
  },
  {
    id: 'tourism',
    title: 'Tourism Boom',
    icon: 'camera',
    blurb: 'A travel blog called your town "unexpectedly delightful". Coaches are inbound.',
    weight: 10,
    cooldown: 24 * day,
    requires: (c) => c.state.pop > 200 && c.countBuilding('park') + c.countBuilding('plaza') >= 2,
    choices: [
      {
        label: 'Welcome them',
        hint: '+congestion, +commercial tax',
        run: (c) => { c.mod('commercialTax', 1.35, 20 * day); c.mod('congestion', 1.4, 20 * day); return 'Shops are ringing. So is every car horn.'; },
      },
      {
        label: 'Cap visitor numbers',
        hint: 'Modest, steady income',
        run: (c) => { c.mod('commercialTax', 1.12, 26 * day); return 'A quieter, longer season.'; },
      },
    ],
  },
  {
    id: 'bridgeFailure',
    title: 'Infrastructure Failure',
    icon: 'crack',
    blurb: 'An inspector found spalling concrete on your oldest road segment.',
    weight: 11,
    cooldown: 26 * day,
    requires: (c) => c.countBuilding('road') > 20,
    choices: [
      {
        label: 'Emergency repairs',
        hint: '-¤450, no disruption',
        run: (c) => { c.cash(-450); return 'Crews worked overnight. Nobody noticed.'; },
      },
      {
        label: 'Close the segment',
        hint: 'Free, heavy congestion',
        run: (c) => { c.mod('congestion', 1.7, 10 * day); c.mood(-6, 10 * day); return 'Detours everywhere. Commuters are furious.'; },
      },
      {
        label: 'Patch and pray',
        hint: 'Risk of a collapse',
        run: (c) => {
          if (c.rng() < 0.45) { c.cash(-900); c.mood(-14, 12 * day); return 'It collapsed. The repair bill doubled.'; }
          return 'It held. This time.';
        },
      },
    ],
  },
  {
    id: 'factoryFire',
    title: 'Factory Fire',
    icon: 'fire',
    blurb: 'Smoke over the industrial district. The alarm is going off somewhere.',
    weight: 12,
    cooldown: 22 * day,
    requires: (c) => c.countBuilding('industrial') > 0,
    choices: [
      {
        label: 'Full response',
        hint: 'Best outcome if you have fire cover',
        run: (c) => {
          const cover = c.coveredRatio('safety');
          if (cover > 0.5) { c.cash(-180); return 'Contained in the hour. One scorched wall.'; }
          c.destroyRandom('industrial', 1, 'safety'); c.mood(-10, 10 * day);
          return 'No station in range. The block is gone.';
        },
      },
      {
        label: 'Let it burn out',
        hint: 'Free, loses industry',
        run: (c) => { c.destroyRandom('industrial', 2); c.mood(-12, 12 * day); return 'Two factories written off.'; },
      },
    ],
  },
  {
    id: 'fluSeason',
    title: 'Fl Season',
    icon: 'mask',
    blurb: 'A nasty strain is going round. Absenteeism is climbing.',
    weight: 11,
    cooldown: 30 * day,
    requires: (c) => c.state.pop > 300,
    choices: [
      {
        label: 'Vaccination drive',
        hint: '-¤400 per 500 citizens',
        run: (c) => { const cost = Math.max(120, Math.round(c.state.pop * 0.8)); c.cash(-cost); c.mood(+3, 10 * day); return `Spent ¤${cost}. The curve flattened.`; },
      },
      {
        label: 'Ride it out',
        hint: 'Productivity drops',
        run: (c) => {
          const hit = c.hasService('health') ? -0.12 : -0.25;
          c.mod('productivity', 1 + hit, 16 * day);
          c.mood(c.hasService('health') ? -4 : -10, 12 * day);
          return c.hasService('health') ? 'The wards coped.' : 'Beds ran out. People stayed home.';
        },
      },
    ],
  },
  {
    id: 'techInvestor',
    title: 'Tech Investor',
    icon: 'rocket',
    blurb: 'A founder wants to relocate her campus here. She has conditions.',
    weight: 8,
    cooldown: 40 * day,
    requires: (c) => c.state.pop > 700 && c.countBuilding('school') >= 1,
    choices: [
      {
        label: 'Roll out the red carpet',
        hint: '-¤800, big commercial boost',
        run: (c) => { c.cash(-800); c.mod('commercialTax', 1.5, 40 * day); c.spawn('commercial'); return 'Glass and steel on the horizon.'; },
      },
      {
        label: 'Standard terms',
        hint: 'Modest boost',
        run: (c) => { c.mod('commercialTax', 1.15, 30 * day); return 'They signed, quietly.'; },
      },
      {
        label: 'Decline',
        hint: 'Residents notice',
        run: (c) => { c.mood(-5, 10 * day); return 'The headline was not flattering.'; },
      },
    ],
  },
  {
    id: 'protest',
    title: 'Rent Protest',
    icon: 'sign',
    blurb: 'A march is forming outside the town hall. The placards mention rent.',
    weight: 10,
    cooldown: 24 * day,
    requires: (c) => c.state.pop > 250 && c.state.taxLevel !== 'low',
    choices: [
      {
        label: 'Cut taxes for a season',
        hint: 'Lose revenue, win hearts',
        run: (c) => { c.mod('taxRate', 0.85, 20 * day); c.mood(+10, 20 * day); return 'The crowd dispersed by dusk.'; },
      },
      {
        label: 'Fund affordable housing',
        hint: '-¤600, spawns Housing',
        run: (c) => { c.cash(-600); c.spawn('residential'); c.mood(+7, 16 * day); return 'Keys handed over on the steps.'; },
      },
      {
        label: 'Hold the line',
        hint: 'Free, mood drops',
        run: (c) => { c.mood(-12, 14 * day); return 'It made the evening news.'; },
      },
    ],
  },
  {
    id: 'festival',
    title: 'Street Festival',
    icon: 'lantern',
    blurb: 'Neighbourhoods are asking for permits to close the roads for a week.',
    weight: 9,
    cooldown: 20 * day,
    requires: (c) => c.state.pop > 180,
    choices: [
      {
        label: 'Permit everything',
        hint: '-¤250, big mood, congestion',
        run: (c) => { c.cash(-250); c.mood(+12, 8 * day); c.mod('congestion', 1.3, 6 * day); return 'Music until midnight for six nights.'; },
      },
      {
        label: 'One parade only',
        hint: '-¤80, small mood',
        run: (c) => { c.cash(-80); c.mood(+5, 5 * day); return 'A tidy, well-behaved afternoon.'; },
      },
    ],
  },
  {
    id: 'brownout',
    title: 'Brownout',
    icon: 'bolt',
    blurb: 'The grid is running hot. Something has to give.',
    weight: 13,
    cooldown: 20 * day,
    requires: (c) => c.state.powerRatio < 1.0 && c.state.pop > 100,
    choices: [
      {
        label: 'Rotating blackouts',
        hint: 'Free, mood hit',
        run: (c) => { c.mood(-10, 10 * day); c.mod('productivity', 0.9, 10 * day); return 'Half the city goes dark each evening.'; },
      },
      {
        label: 'Emergency generator hire',
        hint: '-¤500, tide you over',
        run: (c) => { c.cash(-500); c.mod('powerSupply', 1.25, 14 * day); return 'Diesel and noise, but the lights stayed on.'; },
      },
    ],
  },
  {
    id: 'flood',
    title: 'River Flood',
    icon: 'wave',
    blurb: 'A week of rain has the river over its banks.',
    weight: 9,
    cooldown: 36 * day,
    requires: (c) => c.state.season === 'autumn' || c.state.season === 'winter',
    choices: [
      {
        label: 'Sandbag the banks',
        hint: '-¤350',
        run: (c) => { c.cash(-350); return 'Wet boots, dry homes.'; },
      },
      {
        label: 'Evacuate the low ground',
        hint: 'Free, loses occupancy',
        run: (c) => { c.mod('occupancy', 0.9, 12 * day); c.mood(-7, 10 * day); return 'Families are with relatives for a month.'; },
      },
    ],
  },
  {
    id: 'crimeWave',
    title: 'Crime Wave',
    icon: 'siren',
    blurb: 'Break-ins are up a third this quarter.',
    weight: 10,
    cooldown: 28 * day,
    requires: (c) => c.state.pop > 400,
    choices: [
      {
        label: 'Community patrols',
        hint: '-¤200, needs police',
        run: (c) => {
          c.cash(-200);
          const good = c.hasService('safety');
          c.mood(good ? +4 : -8, 12 * day);
          return good ? 'Officers on the beat. It settled down.' : 'No station to coordinate it. It got worse.';
        },
      },
      {
        label: 'Install street lighting',
        hint: '-¤420, lasting effect',
        run: (c) => { c.cash(-420); c.mod('safetyBonus', 1.1, 60 * day); return 'Warmer streets, calmer nights.'; },
      },
    ],
  },
  {
    id: 'grant',
    title: 'Federal Grant',
    icon: 'scroll',
    blurb: 'A regional development fund is allocating surplus this quarter.',
    weight: 8,
    cooldown: 44 * day,
    requires: () => true,
    choices: [
      {
        label: 'Take the cash',
        hint: '+¤1,200',
        run: (c) => { c.cash(1200); return 'A welcome transfer.'; },
      },
      {
        label: 'Match it with a park',
        hint: '+¤600 and a free Park',
        run: (c) => { c.cash(600); c.spawn('park'); return 'Matching funds, new green space.'; },
      },
    ],
  },
  {
    id: 'strike',
    title: 'Transit Strike',
    icon: 'pick',
    blurb: 'The haulage union has walked out over shift patterns.',
    weight: 9,
    cooldown: 30 * day,
    requires: (c) => c.countBuilding('industrial') >= 2,
    choices: [
      {
        label: 'Meet their terms',
        hint: 'Upkeep +15% for a while',
        run: (c) => { c.mod('upkeep', 1.15, 24 * day); c.mood(+4, 16 * day); return 'The picket line went home.'; },
      },
      {
        label: 'Wait them out',
        hint: 'Industrial output falls',
        run: (c) => { c.mod('industrialTax', 0.7, 14 * day); c.mood(-6, 14 * day); return 'Gates stayed shut for a fortnight.'; },
      },
    ],
  },
  {
    id: 'smog',
    title: 'Smog Alert',
    icon: 'cloud',
    blurb: 'An inversion has trapped the industrial haze over the rooftops.',
    weight: 10,
    cooldown: 26 * day,
    requires: (c) => c.state.pollution > 22,
    choices: [
      {
        label: 'Emission curfew',
        hint: 'Pollution down, industry down',
        run: (c) => { c.mod('pollution', 0.7, 20 * day); c.mod('industrialTax', 0.85, 14 * day); return 'Clearer skies, quieter chimneys.'; },
      },
      {
        label: 'Issue masks',
        hint: '-¤250, mood dip',
        run: (c) => { c.cash(-250); c.mood(-6, 10 * day); return 'Everyone looked vaguely post-apocalyptic.'; },
      },
    ],
  },
  {
    id: 'awards',
    title: 'Livability Award',
    icon: 'trophy',
    blurb: 'A national magazine shortlisted your city for its quality of life.',
    weight: 6,
    cooldown: 50 * day,
    requires: (c) => c.state.happiness > 74 && c.state.pop > 500,
    choices: [
      {
        label: 'Host the ceremony',
        hint: '-¤500, demand surge',
        run: (c) => { c.cash(-500); c.demand('residential', 1.6, 30 * day); c.mood(+8, 24 * day); return 'Moving vans for a month.'; },
      },
      {
        label: 'A quiet press release',
        hint: 'Free, small boost',
        run: (c) => { c.demand('residential', 1.2, 20 * day); return 'A short paragraph, a steady trickle.'; },
      },
    ],
  },
  {
    id: 'treasuryCrisis',
    title: 'Treasury Crisis',
    icon: 'vault',
    blurb: 'The auditor has run out of ways to be diplomatic about the books.',
    weight: 14,
    cooldown: 20 * day,
    requires: (c) => c.state.cash < 400 || c.state.deficit > 2,
    choices: [
      {
        label: 'Emergency loan',
        hint: '+¤2,500 now, interest forever',
        run: (c) => { c.loan(2500); c.mood(-4, 16 * day); return 'The cheque cleared. The auditors did not smile.'; },
      },
      {
        label: 'Austerity package',
        hint: 'Cuts upkeep, hurts mood',
        run: (c) => { c.mod('upkeep', 0.78, 26 * day); c.mood(-10, 18 * day); return 'Swimming pools closed. So did the libraries.'; },
      },
      {
        label: 'Raise taxes to the maximum',
        hint: 'Money now, fury later',
        run: (c) => { c.mod('taxRate', 1.25, 30 * day); c.mood(-14, 20 * day); return 'Revenue doubled. So did the complaints.'; },
      },
    ],
  },
  {
    id: 'sinkhole',
    title: 'Sinkhole',
    icon: 'hole',
    blurb: 'The ground gave way overnight. Something is down there.',
    weight: 7,
    cooldown: 40 * day,
    requires: (c) => c.countBuilding('road') > 12,
    choices: [
      {
        label: 'Fill and repave',
        hint: '-¤380',
        run: (c) => { c.cash(-380); return 'Two truckloads of gravel and a long cone.'; },
      },
      {
        label: 'Fence it off',
        hint: 'Free, becomes a landmark',
        run: (c) => { c.mood(+3, 20 * day); c.demand('commercial', 1.1, 20 * day); return 'It became a minor tourist attraction.'; },
      },
    ],
  },
]);

export function getEvent(id) {
  return EVENTS.find((e) => e.id === id) || null;
}
