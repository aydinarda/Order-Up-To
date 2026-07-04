import { test } from "node:test";
import assert from "node:assert/strict";
import { createRng, deriveSeed } from "../../../server/utils/rng.js";
import { sampleDemand } from "../../../server/utils/demand.js";

test("same seed produces the identical sequence", () => {
  const a = createRng(12345);
  const b = createRng(12345);
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b());
  }
});

test("different seeds produce different sequences", () => {
  const a = createRng(12345);
  const b = createRng(54321);
  const seqA = Array.from({ length: 10 }, () => a());
  const seqB = Array.from({ length: 10 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test("outputs stay in [0, 1)", () => {
  const rand = createRng(deriveSeed());
  for (let i = 0; i < 1000; i++) {
    const x = rand();
    assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
  }
});

test("deriveSeed returns a 32-bit unsigned integer", () => {
  for (let i = 0; i < 100; i++) {
    const seed = deriveSeed();
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
  }
});

test("seeded demand series is reproducible across distributions", () => {
  for (const distribution of [
    { type: "uniform", min: 80, max: 120 },
    { type: "normal", mean: 100, stdDev: 20 }
  ]) {
    const a = createRng(777);
    const b = createRng(777);
    const seriesA = Array.from({ length: 20 }, () => sampleDemand(distribution, a));
    const seriesB = Array.from({ length: 20 }, () => sampleDemand(distribution, b));
    assert.deepEqual(seriesA, seriesB);
  }
});
