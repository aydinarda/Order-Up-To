// Balancing sweep: constant-S policy over the configured horizon.
// Verifies the pedagogical acceptance criteria before defaults are frozen:
//   (a) the profit-maximizing S and the CO2-minimizing S differ materially, and
//   (b) the (profit, CO2) curve over S is genuinely bowed — both CO2 sources bind.
//
// Usage: node scripts/simulate.js [--rounds 12] [--reps 500] [--co2held 0.5] [--capacity 100]

import { advancePeriod, createInitialState, DEFAULT_CONFIG } from "../server/utils/inventory.js";
import { sampleDemand } from "../server/utils/demand.js";
import { createRng } from "../server/utils/rng.js";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? Number(process.argv[index + 1]) : fallback;
}

const rounds = arg("rounds", 12);
const reps = arg("reps", 500);
const config = {
  ...DEFAULT_CONFIG,
  co2PerUnitHeld: arg("co2held", DEFAULT_CONFIG.co2PerUnitHeld),
  truckCapacity: arg("capacity", DEFAULT_CONFIG.truckCapacity),
  startingOnHand: arg("start", DEFAULT_CONFIG.startingOnHand)
};
const distribution = { type: "normal", mean: 100, stdDev: 20 };

// An (R, S) policy: raise inventory position to S every R rounds, submit S = 0
// in between (no order). R = 1 is the classic every-round base-stock policy;
// R > 1 emulates a player who batches shipments for full trucks at the price of
// carrying more stock. Players express this in-game by varying their submitted S.
function simulate(R, S, seed) {
  const rand = createRng(seed);
  let state = createInitialState(config);
  const totals = { profit: 0, co2: 0, transportCo2: 0, storageCo2: 0, lost: 0, demand: 0, trucks: 0, ordered: 0 };

  for (let r = 0; r < rounds; r++) {
    const demand = sampleDemand(distribution, rand);
    const level = r % R === 0 ? S : 0;
    const { nextState, result } = advancePeriod(state, config, demand, level);
    state = nextState;
    totals.profit += result.profit;
    totals.co2 += result.co2;
    totals.transportCo2 += result.transportCo2;
    totals.storageCo2 += result.storageCo2;
    totals.lost += result.lost;
    totals.demand += demand;
    totals.trucks += result.trucks;
    totals.ordered += result.orderQty;
  }

  return totals;
}

const rows = [];
for (const R of [1, 2, 3]) {
  for (let S = 200; S <= 700; S += 25) {
    const acc = { profit: 0, co2: 0, transportCo2: 0, storageCo2: 0, lost: 0, demand: 0, trucks: 0, ordered: 0 };
    for (let rep = 0; rep < reps; rep++) {
      const t = simulate(R, S, 1000 + rep);
      for (const key of Object.keys(acc)) acc[key] += t[key];
    }

    rows.push({
      R,
      S,
      profit: Math.round(acc.profit / reps),
      co2: Math.round(acc.co2 / reps),
      truckCo2: Math.round(acc.transportCo2 / reps),
      storeCo2: Math.round(acc.storageCo2 / reps),
      "lost%": Math.round((acc.lost / acc.demand) * 1000) / 10,
      trucks: Math.round((acc.trucks / reps) * 10) / 10,
      "fill%": acc.trucks > 0 ? Math.round((acc.ordered / (acc.trucks * config.truckCapacity)) * 100) : null
    });
  }
}

console.log(
  `config: L=${config.leadTime} capacity=${config.truckCapacity} truckCost=${config.fixedCostPerTruck} ` +
    `co2/truck=${config.co2PerTruck} co2/unit=${config.co2PerUnitHeld} start=${config.startingOnHand} ` +
    `rounds=${rounds} reps=${reps} demand=N(100,20)`
);
console.table(rows);

// Pareto-efficient policies (maximize profit, minimize co2) — the frontier a
// class full of different strategies would trace out.
const frontier = rows
  .filter((row) => !rows.some((o) => o !== row && o.profit >= row.profit && o.co2 <= row.co2 && (o.profit > row.profit || o.co2 < row.co2)))
  .sort((a, b) => a.co2 - b.co2);
console.log("Pareto frontier (co2 asc):");
console.table(frontier);

const best = rows.reduce((a, b) => (b.profit > a.profit ? b : a));
console.log(`profit-max policy: R=${best.R} S=${best.S} (profit ${best.profit}, co2 ${best.co2})`);
