import { test } from "node:test";
import assert from "node:assert/strict";
import { computeParetoFronts } from "../../../server/utils/pareto.js";

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
