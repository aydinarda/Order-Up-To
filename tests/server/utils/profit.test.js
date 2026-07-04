import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateProfit } from "../../../server/utils/profit.js";

const PRICES = { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 };

test("overstock: leftover units are salvaged", () => {
  const r = calculateProfit(100, 80, PRICES);
  assert.equal(r.soldUnits, 80);
  assert.equal(r.unsoldUnits, 20);
  assert.equal(r.revenue, 3200);
  assert.equal(r.salvageValue, 100);
  assert.equal(r.totalCost, 1000);
  assert.equal(r.profit, 2300);
});

test("understock: demand exceeds order, nothing left over", () => {
  const r = calculateProfit(80, 100, PRICES);
  assert.equal(r.soldUnits, 80);
  assert.equal(r.unsoldUnits, 0);
  assert.equal(r.salvageValue, 0);
  assert.equal(r.profit, 2400);
});

test("exact match: everything sold, no salvage", () => {
  const r = calculateProfit(100, 100, PRICES);
  assert.equal(r.soldUnits, 100);
  assert.equal(r.unsoldUnits, 0);
  assert.equal(r.profit, 3000);
});

test("zero demand: full leftover yields a loss", () => {
  const r = calculateProfit(50, 0, PRICES);
  assert.equal(r.soldUnits, 0);
  assert.equal(r.unsoldUnits, 50);
  assert.equal(r.revenue, 0);
  assert.equal(r.salvageValue, 250);
  assert.equal(r.totalCost, 500);
  assert.equal(r.profit, -250);
});

test("falls back to default prices when none provided", () => {
  const r = calculateProfit(10, 10);
  // defaults {10,40,5}: revenue 400, cost 100 => profit 300
  assert.equal(r.profit, 300);
});

test("respects custom prices", () => {
  const r = calculateProfit(10, 5, { wholesaleCost: 2, retailPrice: 9, salvagePrice: 1 });
  // sold 5*9=45, leftover 5*1=5, cost 10*2=20 => 30
  assert.equal(r.profit, 30);
});
