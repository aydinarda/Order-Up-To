import test from "node:test";
import assert from "node:assert/strict";
import { calculateProfit } from "../../../server/utils/profit.js";

const PRICES = { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 };

// Equivalence classes + boundary values on the (order vs demand) relationship.
// Partition: order < demand (understock) | order == demand (exact) | order > demand (overstock),
// with boundaries at demand-1 / demand / demand+1, zero demand, and the minimum order.
const cases = [
  { name: "understock (order < demand)", order: 80, demand: 100, sold: 80, unsold: 0, profit: 2400 },
  { name: "boundary just-under (order = demand - 1)", order: 99, demand: 100, sold: 99, unsold: 0, profit: 2970 },
  { name: "boundary exact (order = demand)", order: 100, demand: 100, sold: 100, unsold: 0, profit: 3000 },
  { name: "boundary just-over (order = demand + 1)", order: 101, demand: 100, sold: 100, unsold: 1, profit: 2995 },
  { name: "overstock (order > demand)", order: 120, demand: 100, sold: 100, unsold: 20, profit: 2900 },
  { name: "boundary zero demand", order: 50, demand: 0, sold: 0, unsold: 50, profit: -250 },
  { name: "boundary minimum order (order = 1)", order: 1, demand: 100, sold: 1, unsold: 0, profit: 30 },
  { name: "extreme overstock yields a loss", order: 1000, demand: 100, sold: 100, unsold: 900, profit: -1500 }
];

for (const tc of cases) {
  test(`profit EC/boundary — ${tc.name}`, () => {
    const r = calculateProfit(tc.order, tc.demand, PRICES);
    assert.equal(r.soldUnits, tc.sold, "soldUnits");
    assert.equal(r.unsoldUnits, tc.unsold, "unsoldUnits");
    assert.equal(r.profit, tc.profit, "profit");
    // output decomposition invariants
    assert.equal(r.revenue, tc.sold * PRICES.retailPrice, "revenue");
    assert.equal(r.salvageValue, tc.unsold * PRICES.salvagePrice, "salvageValue");
    assert.equal(r.totalCost, tc.order * PRICES.wholesaleCost, "totalCost");
  });
}

test("profit formula invariant holds across the whole input space", () => {
  for (let i = 0; i < 5000; i++) {
    const order = 1 + Math.floor(Math.random() * 500);
    const demand = Math.floor(Math.random() * 500);
    const r = calculateProfit(order, demand, PRICES);

    const sold = Math.min(order, demand);
    const unsold = order - sold;

    assert.equal(r.soldUnits, sold);
    assert.equal(r.unsoldUnits, unsold);
    assert.equal(
      r.profit,
      sold * PRICES.retailPrice + unsold * PRICES.salvagePrice - order * PRICES.wholesaleCost
    );
  }
});
