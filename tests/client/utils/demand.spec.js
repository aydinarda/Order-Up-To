import { describe, it, expect } from "vitest";
import { sampleDemand, describeDistribution } from "../../../src/utils/demand.js";

describe("sampleDemand (frontend)", () => {
  it("uniform stays within [min, max]", () => {
    for (let i = 0; i < 1000; i++) {
      const d = sampleDemand({ type: "uniform", min: 80, max: 120 });
      expect(d).toBeGreaterThanOrEqual(80);
      expect(d).toBeLessThanOrEqual(120);
    }
  });

  it("normal is clamped to [min, max]", () => {
    for (let i = 0; i < 1000; i++) {
      const d = sampleDemand({ type: "normal", mean: 100, stdDev: 50, min: 80, max: 120 });
      expect(d).toBeGreaterThanOrEqual(80);
      expect(d).toBeLessThanOrEqual(120);
    }
  });

  it("normal with stdDev=0 returns the mean", () => {
    expect(sampleDemand({ type: "normal", mean: 100, stdDev: 0, min: 80, max: 120 })).toBe(100);
  });

  it("throws on an unsupported type", () => {
    expect(() => sampleDemand({ type: "poisson" })).toThrow(/Unsupported distribution type/);
  });
});

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
