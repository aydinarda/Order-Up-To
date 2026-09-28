import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeParetoFronts,
  DEFAULT_PARETO_AXES,
  isValidParetoAxes,
  paretoAxesFromConfig
} from "../../../server/utils/pareto.js";

function row(name, cumProfit, cumCo2) {
  return { nickname: name, cumProfit, cumCo2 };
}

test("hand-built dominance set yields known fronts", () => {
  // A (high profit, low co2) dominates C and D.
  // B (highest profit, highest co2) is undominated (nobody beats its profit).
  // E (lowest co2) is undominated.
  // C dominates D. So fronts: [A, B, E], [C], [D].
  const rows = [
    row("A", 1000, 500),
    row("B", 1200, 2000),
    row("C", 800, 600),
    row("D", 700, 700),
    row("E", 300, 100)
  ];
  const sorted = computeParetoFronts(rows);
  const byName = Object.fromEntries(sorted.map((r) => [r.nickname, r.front]));
  assert.deepEqual(byName, { A: 1, B: 1, E: 1, C: 2, D: 3 });
});

test("rows are sorted by (front asc, profit desc)", () => {
  const rows = [
    row("low", 300, 100),
    row("mid", 1000, 500),
    row("top", 1200, 2000),
    row("dominated", 800, 600)
  ];
  const sorted = computeParetoFronts(rows);
  assert.deepEqual(
    sorted.map((r) => r.nickname),
    ["top", "mid", "low", "dominated"]
  );
});

test("identical points share a front (whole-class-same-strategy degenerate case)", () => {
  const rows = [row("A", 500, 300), row("B", 500, 300), row("C", 500, 300)];
  const sorted = computeParetoFronts(rows);
  assert.ok(sorted.every((r) => r.front === 1));
});

test("equal profit, different co2: lower co2 dominates", () => {
  const rows = [row("clean", 500, 100), row("dirty", 500, 900)];
  const sorted = computeParetoFronts(rows);
  const byName = Object.fromEntries(sorted.map((r) => [r.nickname, r.front]));
  assert.deepEqual(byName, { clean: 1, dirty: 2 });
});

test("single player lands on front 1", () => {
  const sorted = computeParetoFronts([row("solo", 42, 42)]);
  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].front, 1);
});

test("empty input returns empty output", () => {
  assert.deepEqual(computeParetoFronts([]), []);
});

test("input rows are not mutated", () => {
  const rows = [row("A", 1, 1), row("B", 2, 2)];
  computeParetoFronts(rows);
  assert.deepEqual(rows, [row("A", 1, 1), row("B", 2, 2)]);
});

test("a fully layered chain produces one front per row", () => {
  // Each next row has lower profit AND higher co2 -> strictly dominated chain.
  const rows = [row("r1", 400, 100), row("r2", 300, 200), row("r3", 200, 300), row("r4", 100, 400)];
  const sorted = computeParetoFronts(rows);
  assert.deepEqual(
    sorted.map((r) => r.front),
    [1, 2, 3, 4]
  );
});

// ── Any pair of the four KPIs ───────────────────────────────────────────────
function kpis(name, { profit = 0, co2 = 0, backorders = 0, service = null } = {}) {
  return {
    nickname: name,
    cumProfit: profit,
    cumCo2: co2,
    cumBackorders: backorders,
    serviceLevelPct: service
  };
}

test("service level (maximize) vs backorders (minimize) uses each KPI's own direction", () => {
  const rows = [
    kpis("reliable", { service: 95, backorders: 10 }),
    kpis("sloppy", { service: 60, backorders: 80 }),
    kpis("lean", { service: 80, backorders: 5 })
  ];
  const sorted = computeParetoFronts(rows, { x: "backorders", y: "serviceLevel" });
  const byName = Object.fromEntries(sorted.map((r) => [r.nickname, r.front]));
  // reliable wins on service, lean on backorders; sloppy is beaten by both.
  assert.deepEqual(byName, { reliable: 1, lean: 1, sloppy: 2 });
  // Within a front: best Y (service level) first.
  assert.deepEqual(
    sorted.map((r) => r.nickname),
    ["reliable", "lean", "sloppy"]
  );
});

test("the same players rank differently on a different pair", () => {
  const rows = [
    kpis("green", { profit: 100, co2: 10, backorders: 50 }),
    kpis("rich", { profit: 900, co2: 400, backorders: 0 })
  ];
  const onCo2 = computeParetoFronts(rows, { x: "co2", y: "profit" });
  const onBackorders = computeParetoFronts(rows, { x: "backorders", y: "profit" });
  assert.deepEqual(onCo2.map((r) => r.front), [1, 1]); // a genuine trade-off
  assert.deepEqual(
    onBackorders.map((r) => [r.nickname, r.front]),
    [
      ["rich", 1],
      ["green", 2]
    ]
  );
});

test("a missing service level (no demand yet) counts as the worst value", () => {
  const rows = [kpis("late", { profit: 500 }), kpis("played", { profit: 500, service: 40 })];
  const sorted = computeParetoFronts(rows, { x: "serviceLevel", y: "profit" });
  const byName = Object.fromEntries(sorted.map((r) => [r.nickname, r.front]));
  assert.deepEqual(byName, { played: 1, late: 2 });
});

test("axis validation and config fallback", () => {
  assert.equal(isValidParetoAxes({ x: "co2", y: "profit" }), true);
  assert.equal(isValidParetoAxes({ x: "profit", y: "profit" }), false);
  assert.equal(isValidParetoAxes({ x: "happiness", y: "profit" }), false);
  assert.deepEqual(paretoAxesFromConfig({ paretoX: "backorders", paretoY: "serviceLevel" }), {
    x: "backorders",
    y: "serviceLevel"
  });
  assert.deepEqual(paretoAxesFromConfig({}), DEFAULT_PARETO_AXES);
  assert.deepEqual(paretoAxesFromConfig(null), DEFAULT_PARETO_AXES);
});
