import { describe, it, expect } from "vitest";
import { describeDistribution, zeroDemandShare } from "../../../src/utils/demand.js";

describe("describeDistribution", () => {
  it("formats uniform", () => {
    expect(describeDistribution({ type: "uniform", min: 80, max: 120 })).toBe("Uniform [80, 120]");
  });

  it("formats normal", () => {
    expect(describeDistribution({ type: "normal", mean: 100, stdDev: 10 })).toBe("Normal (μ=100, σ=10)");
  });

  it("falls back to Unknown for unrecognized types", () => {
    expect(describeDistribution({ type: "weird" })).toBe("Unknown distribution");
  });
});

describe("zeroDemandShare", () => {
  it("matches the normal CDF at the mean's distance from zero", () => {
    expect(zeroDemandShare(100, 100)).toBeCloseTo(0.1587, 4); // Φ(−1)
    expect(zeroDemandShare(100, 50)).toBeCloseTo(0.0228, 4); // Φ(−2)
    expect(zeroDemandShare(100, 20)).toBeLessThan(1e-6); // Φ(−5)
  });

  it("is zero without spread or with an invalid mean", () => {
    expect(zeroDemandShare(100, 0)).toBe(0);
    expect(zeroDemandShare(0, 10)).toBe(0);
  });
});
