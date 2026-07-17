// Express-van decision analysis — the INDIVIDUAL player's call, not a class sweep.
//
// The in-game choice is atomic and faithful to submit-order (one mode per round):
// "I need to restock ~q this round — send it by consolidated truck (cheap, arrives
// in L) or by express van (dear + dirty, arrives next round)?" We simulate one
// player from a given starting situation down two branches that differ ONLY in the
// round-0 delivery mode, on the SAME demand draws, then compare (profit, CO2, lost).
//
// Verdict uses the exact leaderboard dominance rule (maximize profit, minimize CO2):
//   - express DOMINATED  → strictly worse profit AND CO2 → a bad call (waste).
//   - express DOMINATES  → better on both → a no-brainer (rare; express is dirtier).
//   - TRADE-OFF          → more profit for more CO2 → a legitimate rescue you pay for.
//
// Pedagogical claim under test: express should be a bad call when you are well
// stocked or when L = 1 (no timing gain), and a rational profit-saving trade-off
// when your trucks arrive late (high L) and a stockout would otherwise book losses.
//
// Usage: node scripts/express-analysis.js [--reps 800] [--horizon 0=auto]
// The engine and dominance rule are the SAME modules the live game uses.

import {
  advancePeriod,
  DEFAULT_CONFIG,
  EXPRESS_LEAD_TIME
} from "../server/utils/inventory.js";
import { sampleDemand } from "../server/utils/demand.js";
import { createRng } from "../server/utils/rng.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? Number(process.argv[i + 1]) : fallback;
}

const MU = 100;
const SIGMA = 20;
const distribution = { type: "normal", mean: MU, stdDev: SIGMA };
// Critical ratio with the default margins: Cu = price-unitCost = 30, Co = holding
// = 1 → CR = 30/31 ≈ 0.968 → z ≈ 1.85. The high-service base-stock target.
const Z = 1.85;
const REPS = arg("reps", 800);

const baseStock = (L) => Math.round((L + 1) * MU + Z * Math.sqrt(L + 1) * SIGMA);

// Same rule as server/utils/pareto.js (maximize profit, minimize co2).
function dominates(a, b) {
  return a.profit >= b.profit && a.co2 <= b.co2 && (a.profit > b.profit || a.co2 < b.co2);
}

function verdict(A, B) {
  if (dominates(B, A)) return "express DOMINATES (rare)";
  if (dominates(A, B)) return "express dominated (bad)";
  return "trade-off (profit↑ CO₂↑)";
}

// One player over `horizon` rounds. Round 0 places the base-stock reorder by
// `round0Mode`; every later round tops up to S by consolidated truck. The warehouse
// opens with `onHand` and an empty pipeline. Same seed ⇒ identical demand across
// the two branches being compared.
function runBranch({ config, L, S, onHand, round0Mode, horizon, seed }) {
  const rand = createRng(seed);
  let state = { onHand, pipeline: Array.from({ length: L + 1 }, () => 0) };
  const t = { profit: 0, co2: 0, lost: 0 };

  for (let r = 0; r < horizon; r++) {
    const demand = sampleDemand(distribution, rand);
    const ip = state.onHand + state.pipeline.reduce((s, q) => s + q, 0);
    const q = Math.max(0, S - ip);
    const mode = r === 0 ? round0Mode : "consolidated";
    const leadTime = mode === "express" ? EXPRESS_LEAD_TIME : L;
    const { nextState, result } = advancePeriod(state, config, demand, q, { mode, leadTime });
    state = nextState;
    t.profit += result.profit;
    t.co2 += result.co2;
    t.lost += result.lost;
  }
  return t;
}

// A situation is defined by how much of the lead-time gap the opening stock covers:
// onHand = cover × L × μ. cover ≥ ~1 means the truck's lateness is harmless (no
// stockout before it lands); cover < 1 means a loss looms unless you act. Scaling
// by L keeps "well-stocked" meaning the same thing at every lead time.
const coverOnHand = (cover, L) => Math.round(cover * L * MU);

// Average both branches over REPS shared seeds and return the B−A deltas + verdict.
function compare({ L, expressFixedCost, onHand }) {
  const config = { ...DEFAULT_CONFIG, leadTime: L, expressFixedCost };
  const S = baseStock(L);
  const horizon = L + 4;
  const acc = {
    A: { profit: 0, co2: 0, lost: 0 },
    B: { profit: 0, co2: 0, lost: 0 }
  };

  for (let rep = 0; rep < REPS; rep++) {
    const seed = 1000 + rep;
    const A = runBranch({ config, L, S, onHand, round0Mode: "consolidated", horizon, seed });
    const B = runBranch({ config, L, S, onHand, round0Mode: "express", horizon, seed });
    for (const k of ["profit", "co2", "lost"]) {
      acc.A[k] += A[k];
      acc.B[k] += B[k];
    }
  }

  const A = {};
  const B = {};
  for (const k of ["profit", "co2", "lost"]) {
    A[k] = acc.A[k] / REPS;
    B[k] = acc.B[k] / REPS;
  }

  return {
    S,
    dProfit: Math.round(B.profit - A.profit),
    dCo2: Math.round(B.co2 - A.co2),
    dLost: Math.round(B.lost - A.lost),
    verdict: verdict(A, B)
  };
}

// cover = onHand as a multiple of the lead-time demand L·μ (see coverOnHand).
const scenarios = [
  { name: "well-stocked", cover: 1.3 },
  { name: "tight", cover: 0.8 },
  { name: "critical-low", cover: 0.3 }
];

console.log(
  `express decision analysis — demand N(${MU},${SIGMA}), reps=${REPS}, ` +
    `truck(cap ${DEFAULT_CONFIG.truckCapacity}, $${DEFAULT_CONFIG.fixedCostPerTruck}, ` +
    `${DEFAULT_CONFIG.co2PerTruck}kg), express(cap ${DEFAULT_CONFIG.expressCapacity}, ` +
    `default $${DEFAULT_CONFIG.expressFixedCost}, ${DEFAULT_CONFIG.expressCo2}kg), ` +
    `margin $${DEFAULT_CONFIG.price - DEFAULT_CONFIG.unitCost}/u`
);

// ── Table 1: situation × lead time, at the default express cost ───────────────
console.log(
  `\n[1] Express vs wait — B−A deltas by situation and lead time (expressFixedCost=${DEFAULT_CONFIG.expressFixedCost}):`
);
const table1 = [];
for (const s of scenarios) {
  for (const L of [1, 2, 3, 4, 5]) {
    const onHand = coverOnHand(s.cover, L);
    const r = compare({ L, expressFixedCost: DEFAULT_CONFIG.expressFixedCost, onHand });
    table1.push({
      situation: s.name,
      L,
      "onHand→S": `${onHand}→${r.S}`,
      "Δprofit": r.dProfit,
      "ΔCO₂(kg)": r.dCo2,
      "Δlost(u)": r.dLost,
      verdict: r.verdict
    });
  }
}
console.table(table1);

// ── Table 2: express-cost sensitivity in the critical-low situation ───────────
console.log(`\n[2] Express-cost sensitivity — critical-low situation (cover=0.3·L·μ):`);
const table2 = [];
for (const L of [2, 4]) {
  for (const expressFixedCost of [80, 120, 160, 200]) {
    const r = compare({ L, expressFixedCost, onHand: coverOnHand(0.3, L) });
    table2.push({
      L,
      expressFixedCost,
      "Δprofit": r.dProfit,
      "ΔCO₂(kg)": r.dCo2,
      "Δlost(u)": r.dLost,
      verdict: r.verdict
    });
  }
}
console.table(table2);
