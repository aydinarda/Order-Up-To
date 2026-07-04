import { describe, it, expect } from "vitest";
import { calculateProfit, PRICE } from "../../../src/utils/profit.js";

describe("calculateProfit (frontend, fixed prices)", () => {
  it("salvages leftover units when overstocked", () => {
    const r = calculateProfit(100, 80);
    expect(r).toMatchObject({
      soldUnits: 80,
      unsoldUnits: 20,
      revenue: 3200,
      salvageValue: 100,
      totalCost: 1000,
      profit: 2300
    });
  });

  it("has no leftovers when understocked", () => {
    const r = calculateProfit(80, 100);
    expect(r.unsoldUnits).toBe(0);
    expect(r.salvageValue).toBe(0);
    expect(r.profit).toBe(2400);
  });

  it("sells everything on an exact match", () => {
    expect(calculateProfit(100, 100).profit).toBe(3000);
  });

  it("exposes the fixed price constants", () => {
    expect(PRICE).toEqual({ wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 });
  });
});
