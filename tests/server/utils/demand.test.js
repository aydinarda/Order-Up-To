import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleDemand } from "../../../server/utils/demand.js";
import { createRng } from "../../../server/utils/rng.js";

test("uniform stays within [min, max]", () => {
  for (let i = 0; i < 1000; i++) {
    const d = sampleDemand({ type: "uniform", min: 80, max: 120 });
    assert.ok(d >= 80 && d <= 120, `out of range: ${d}`);
  }
});

test("uniform with min === max is deterministic", () => {
  assert.equal(sampleDemand({ type: "uniform", min: 100, max: 100 }), 100);
});

test("uniform honors a stubbed Math.random (lower bound)", () => {
  const original = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(sampleDemand({ type: "uniform", min: 80, max: 120 }), 80);
  } finally {
    Math.random = original;
  }
});

test("uniform reaches its upper bound", () => {
  const original = Math.random;
  Math.random = () => 0.999999;
  try {
    assert.equal(sampleDemand({ type: "uniform", min: 80, max: 120 }), 120);
  } finally {
    Math.random = original;
  }
});

test("uniform gives every integer, endpoints included, the same chance", () => {
  const rand = createRng(7);
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const n = 40000;
  for (let i = 0; i < n; i++) counts[sampleDemand({ type: "uniform", min: 1, max: 4 }, rand)] += 1;
  for (const value of [1, 2, 3, 4]) {
    const share = counts[value] / n;
    assert.ok(Math.abs(share - 0.25) < 0.01, `P(${value}) = ${share}, expected 0.25`);
  }
});

test("normal with stdDev=0 collapses to the mean", () => {
  for (let i = 0; i < 100; i++) {
    assert.equal(sampleDemand({ type: "normal", mean: 100, stdDev: 0 }), 100);
  }
});

test("normal output is never negative (low draws clamp to 0)", () => {
  for (let i = 0; i < 2000; i++) {
    const d = sampleDemand({ type: "normal", mean: 5, stdDev: 20 });
    assert.ok(d >= 0, `negative draw: ${d}`);
  }
});

test("normal maps a deeply negative draw straight to 0", () => {
  const original = Math.random;
  // u → tiny (large magnitude), v = 0.5 → cos(2πv) = -1, so z is large negative.
  const queue = [1e-12, 0.5];
  Math.random = () => queue.shift();
  try {
    assert.equal(sampleDemand({ type: "normal", mean: 5, stdDev: 20 }), 0);
  } finally {
    Math.random = original;
  }
});

test("unsupported distribution type throws", () => {
  assert.throws(() => sampleDemand({ type: "poisson" }), /Unsupported distribution type/);
});
