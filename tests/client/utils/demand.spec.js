import { describe, it, expect } from "vitest";
import { describeDistribution } from "../../../src/utils/demand.js";

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
