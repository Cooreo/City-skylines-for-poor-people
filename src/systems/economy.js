/**
 * economy.js — taxes, upkeep, the treasury and deficit handling.
 *
 * Balance intent (see docs/01-GAME-DESIGN.md §Economy):
 *   • The starting grant is ¤12,000: enough to lay down a starter network,
 *     the two utilities and a first ring of housing, with ¤2,000–3,000 left
 *     as a buffer while tax income ramps up.
 *   • A healthy mid-game city runs at roughly +¤40/tick on 900 citizens.
 *   • Every service building should pay for itself within ~15 ticks of the
 *     growth it enables, otherwise players learn to skip services.
 *   • Zoned upkeep scales with occupancy (18% floor): an empty lot is cheap,
 *     so over-zoning is a bet rather than a penalty.
 *   • Deficit is a *soft* fail state: happiness decays, which stalls growth,
 *     which deepens the deficit. Recoverable, but visibly spiralling.
 *
 * Rate table (¤ per tick) — see RATES below
 *   residential  0.10 × resident
 *   commercial   0.22 × job       (shops are the tax workhorse)
 *   industrial   0.16 × job       (fewer, but they anchor employment)
 */

import { getDef, TIERS } from '../data/buildings.js';
import { removeInstance } from './build.js';
import { TAX_LEVELS } from '../data/progression.js';

export const RATES = Object.freeze({
  residential: 0.10,
  commercial: 0.22,
  industrial: 0.16,
  roadPerTile: 0.02,
});

export const HISTORY_LEN = 60;

/** Interest charged per tick on an outstanding loan, as a fraction of principal. */
export const LOAN_RATE = 0.006;
/** Cash floor below which the city is bankrupt and growth stops entirely. */
export const BANKRUPTCY_FLOOR = 0;
/**
 * Emergency loans are a FIXED tranche, not a proportion of the shortfall.
 * A proportional loan compounds: interest deepens the hole, the next loan is
 * bigger, and within a few hundred ticks the treasury overflows to 1e17.
 * A fixed tranche makes the penalty a real, bounded number.
 */
export const EMERGENCY_TRANCHE = 1500;
/** Ticks between emergency tranches, so interest cannot outrun the relief. */
export const EMERGENCY_COOLDOWN = 6;
/** Hard cap on outstanding emergency loans. Beyond it, austerity kicks in. */
export const MAX_EMERGENCY_LOANS = 4;

export function taxMultiplier(state) {
  const row = TAX_LEVELS.find((t) => t.id === state.economy.taxLevel) || TAX_LEVELS[1];
  return row.rate;
}

/** Town Halls add a flat percentage to all tax income. */
export function civicBonus(state) {
  let bonus = 1;
  const b = state.grid.buildings;
  for (let i = 0; i < b.length; i++) {
    const bl = b[i];
    if (!bl || bl.def !== 'civic') continue;
    const def = getDef('civic');
    bonus += def.taxBonus * bl.tier;
  }
  return Math.min(1.6, bonus);
}

export function update(state, mods) {
  const city = state.city;
  const eco = state.economy;

  /* ── income ──────────────────────────────────────────────────────────── */
  // Educated citizens earn more, so they tax more. Coverage is capped so the
  // bonus saturates rather than scaling forever.
  const edu = 1 + Math.min(0.28, city.coverage.education * 0.35);
  const tax = taxMultiplier(state);
  const civic = civicBonus(state);
  const productivity = mods.productivity;

  const fromResidential = city.pop * RATES.residential * tax * (mods.residentialTax || 1) * edu * civic;
  const fromCommercial = city.commercialJobs * RATES.commercial * tax * (mods.commercialTax || 1) * edu * civic * productivity;
  const fromIndustrial = city.industrialJobs * RATES.industrial * tax * (mods.industrialTax || 1) * edu * civic * productivity;

  const income = fromResidential + fromCommercial + fromIndustrial;

  /* ── expenses ────────────────────────────────────────────────────────── */
  let upkeep = 0;
  const buildings = state.grid.buildings;
  for (let i = 0; i < buildings.length; i++) {
    const b = buildings[i];
    if (!b) continue;
    const def = getDef(b.def);
    if (!def || !def.upkeep) continue;
    // Zoned upkeep scales with occupancy. An empty lot costs almost nothing
    // to run, so a player who zones generously is not punished before the
    // citizens arrive -- that was the difference between a city that could
    // recover from a slow start and one that could not.
    const isZoned = def.zone === 'residential' || def.zone === 'commercial'
      || def.zone === 'industrial' || def.zone === 'park';
    const occFactor = isZoned ? 0.18 + (b.occ || 0) * 0.82 : 1;
    upkeep += def.upkeep * TIERS.UPKEEP[b.tier - 1] * occFactor;
  }
  upkeep *= mods.upkeep;
  const roadUpkeep = (city.roadTiles || 0) * RATES.roadPerTile;

  // Interest on outstanding treasury loans: the cost of deficit handling.
  let interest = 0;
  for (const loan of eco.loans) interest += loan.principal * LOAN_RATE;

  const expense = upkeep + roadUpkeep + interest;
  const net = income - expense;

  /* ── apply ───────────────────────────────────────────────────────────── */
  eco.income = income;
  eco.expense = expense;
  eco.net = net;
  eco.upkeep = upkeep;
  eco.roadUpkeep = roadUpkeep;
  eco.interest = interest;
  eco.breakdown = { fromResidential, fromCommercial, fromIndustrial, upkeep, roadUpkeep, interest };

  transfer(state, net, 'taxes');

  if (eco.cash < 0) {
    eco.deficitStreak++;
    eco.everDeficit = true;
    if (eco.deficitStreak === 1) return { warning: 'deficit' };
    if (eco.deficitStreak % 4 === 0) return { warning: 'deepDeficit', streak: eco.deficitStreak };
  } else {
    eco.deficitStreak = 0;
  }

  return null;
}

/** The one and only way money moves. Every call is logged for the ledger. */
export function transfer(state, amount, reason = 'misc') {
  const eco = state.economy;
  eco.cash += amount;
  if (amount > 0) eco.totalEarned += amount;
  else eco.totalSpent += -amount;
  return amount;
}

/** Push the current net onto the sparkline ring buffer. */
export function recordHistory(state) {
  const h = state.economy.history;
  h.push(Math.round(state.economy.net));
  if (h.length > HISTORY_LEN) h.shift();
}

/** Can the player afford this right now? Used by the palette to dim items. */
export function canAfford(state, cost) {
  return state.economy.cash >= cost;
}

/* ── treasury loans ─────────────────────────────────────────────────────── */

/**
 * Borrow from the treasury. Loans are the only way to recover once cash has
 * hit the floor: without them a city that overspends early can never build
 * again, which is a dead end rather than a challenge.
 */
export function takeLoan(state, amount) {
  const principal = Math.max(0, Math.round(amount));
  if (!principal) return null;
  state.economy.loans.push({ principal, rate: LOAN_RATE, takenAt: state.tick, takenOnDay: state.day });
  transfer(state, principal, 'loan');
  return state.economy.loans[state.economy.loans.length - 1];
}

/** Repay one loan in full. Interest already paid is not refunded. */
export function repayLoan(state, index = 0) {
  const loan = state.economy.loans[index];
  if (!loan) return false;
  if (state.economy.cash < loan.principal) return false;
  transfer(state, -loan.principal, 'repayment');
  state.economy.loans.splice(index, 1);
  return true;
}

export const totalDebt = (state) => state.economy.loans.reduce((a, l) => a + l.principal, 0);

/**
 * Bankruptcy guard. Cash may not fall below the floor: if a tick would take it
 * there, an emergency loan covers the shortfall so the player always retains
 * the ability to act. The penalty is compounding interest, not a locked-out
 * game.
 */
export function enforceFloor(state, bus) {
  const eco = state.economy;
  if (eco.cash >= BANKRUPTCY_FLOOR) return null;

  const emergencyCount = eco.loans.filter((l) => l.emergency).length;
  const onCooldown = state.tick - (eco.lastEmergencyAt || -99) < EMERGENCY_COOLDOWN;

  if (emergencyCount < MAX_EMERGENCY_LOANS && !onCooldown) {
    eco.lastEmergencyAt = state.tick;
    const loan = takeLoan(state, EMERGENCY_TRANCHE);
    loan.emergency = true;
    eco.everEmergencyLoan = true;
    if (bus) {
      bus.emit('toast', {
        text: `Treasury overdrawn: emergency loan of ${formatMoney(EMERGENCY_TRANCHE)} taken (${emergencyCount + 1}/${MAX_EMERGENCY_LOANS}), interest ${(LOAN_RATE * 100).toFixed(1)}%/tick.`,
        tone: 'danger', ttl: 7000,
      });
    }
    return EMERGENCY_TRANCHE;
  }

  // Out of credit: the treasury mothballs its most expensive service building.
  // This keeps the simulation bounded and gives the player visible feedback
  // that their budget is unsustainable, instead of a silent death spiral.
  const closed = austerityShutdown(state);
  if (bus && closed) {
    bus.emit('toast', {
      text: `No credit left: ${closed} was mothballed to balance the books.`,
      tone: 'danger', ttl: 7000,
    });
  }
  return null;
}

/** Most expensive upkeep-per-utility service building, removed to cut costs. */
/**
 * What austerity may close, in order. Power and water are deliberately absent:
 * closing the grid collapses occupancy, which collapses income, which can
 * never recover. Better to let the treasury sit in the red -- the player can
 * always bulldoze their own zones to climb out.
 */
const MOTHBALL_ORDER = [
  'stadium', 'plaza', 'civic', 'subway', 'hospital', 'school', 'policeStation', 'fireStation',
];

function austerityShutdown(state) {
  const buildings = state.grid.buildings;
  const w = state.grid.w;
  for (const defId of MOTHBALL_ORDER) {
    let worst = -1, worstCost = 0;
    for (let i = 0; i < buildings.length; i++) {
      const b = buildings[i];
      if (!b || !b.anchor || b.def !== defId) continue;
      const cost = getDef(defId).upkeep * TIERS.UPKEEP[b.tier - 1];
      if (cost > worstCost) { worstCost = cost; worst = i; }
    }
    if (worst === -1) continue;
    const label = getDef(defId).label;
    // removeInstance clears the whole footprint, not just the anchor tile.
    removeInstance(state, worst % w, (worst / w) | 0);
    return label;
  }
  return null;
}

export function formatMoney(v) {
  const n = Math.round(v);
  const sign = n < 0 ? '-' : '';
  return `${sign}\u00a4${Math.abs(n).toLocaleString('en-US')}`;
}

/** Projected ticks until the treasury empties at the current burn rate. */
export function runwayTicks(state) {
  if (state.economy.net >= 0) return Infinity;
  return Math.max(0, Math.floor(state.economy.cash / -state.economy.net));
}
