import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advancePeriod,
  createInitialState,
  DEFAULT_CONFIG
} from "../../../server/utils/inventory.js";

const config = { ...DEFAULT_CONFIG, leadTime: 2 };

test("initial state is an empty warehouse with an empty pipeline of length L", () => {
  const state = createInitialState(config);
  assert.equal(state.onHand, 0);
  assert.deepEqual(state.pipeline, [0, 0]);
});

test("priming round: no sales, opening order arrives with lead time 1", () => {
  const state = createInitialState(config);
  const { nextState, result } = advancePeriod(state, config, 100, 150, {
    leadTime: 1,
    priming: true
  });
  assert.equal(result.priming, true);
  assert.equal(result.demand, null);
  assert.equal(result.sold, 0);
  assert.equal(result.lost, 0);
  assert.equal(result.orderQty, 150);
  assert.equal(result.trucks, 2);
  // Opening order sits at pipeline[0] -> arrives next round.
  assert.deepEqual(nextState.pipeline, [150, 0]);

  // Next round it arrives and can be sold.
  const step2 = advancePeriod(nextState, config, 100, 0);
  assert.equal(step2.result.arrival, 150);
  assert.equal(step2.result.sold, 100);
});

test("a normal order placed in round t arrives exactly at the start of round t+L", () => {
  // L = 2. Zero demand throughout so arrivals are the only inventory movement.
  let state = createInitialState(config);

  // Round t: order 100 (normal lead time 2). Not yet on hand.
  let step = advancePeriod(state, config, 0, 100);
  assert.equal(step.result.orderQty, 100);
  assert.equal(step.nextState.onHand, 0);
  assert.deepEqual(step.nextState.pipeline, [0, 100]);

  // Round t+1: nothing arrives yet.
  step = advancePeriod(step.nextState, config, 0, 0);
  assert.equal(step.result.arrival, 0);
  assert.equal(step.nextState.onHand, 0);

  // Round t+2 = t+L: the 100 units arrive.
  step = advancePeriod(step.nextState, config, 0, 0);
  assert.equal(step.result.arrival, 100);
  assert.equal(step.nextState.onHand, 100);
});

test("lost sales: unmet demand is lost, not backordered", () => {
  const state = { onHand: 50, pipeline: [0, 0] };
  const { nextState, result } = advancePeriod(state, config, 80, 0);
  assert.equal(result.sold, 50);
  assert.equal(result.lost, 30);
  assert.equal(result.onHandEnd, 0);
  assert.equal(nextState.onHand, 0);
});

test("arrival is available to serve the same period's demand", () => {
  const state = { onHand: 10, pipeline: [40, 0] };
  const { result } = advancePeriod(state, config, 45, 0);
  assert.equal(result.arrival, 40);
  assert.equal(result.sold, 45);
  assert.equal(result.lost, 0);
  assert.equal(result.onHandEnd, 5);
});

test("the order quantity is placed directly (not derived from inventory position)", () => {
  const state = { onHand: 100, pipeline: [20, 30] };
  // demand 60 -> onHandEnd = 100 + 20 - 60 = 60; remaining in transit = 30; IP = 90.
  const { result, nextState } = advancePeriod(state, config, 60, 160);
  assert.equal(result.inventoryPosition, 90);
  assert.equal(result.orderQty, 160); // exactly what was asked
  assert.deepEqual(nextState.pipeline, [30, 160]);
});

test("ordering zero places nothing and emits no transport cost or CO2", () => {
  const state = { onHand: 200, pipeline: [0, 100] };
  const { result } = advancePeriod(state, config, 0, 0);
  assert.equal(result.orderQty, 0);
  assert.equal(result.trucks, 0);
  assert.equal(result.transportCo2, 0);
  assert.equal(result.truckCost, 0);
  assert.equal(result.truckFillPct, null);
});

test("negative orders are clamped to zero", () => {
  const state = { onHand: 0, pipeline: [0, 0] };
  const { result } = advancePeriod(state, config, 0, -50);
  assert.equal(result.orderQty, 0);
  assert.equal(result.trucks, 0);
});

test("truck count is ceil(q / capacity): edges q=1, q=cap, q=cap+1", () => {
  const cases = [
    { q: 1, trucks: 1 },
    { q: config.truckCapacity, trucks: 1 },
    { q: config.truckCapacity + 1, trucks: 2 }
  ];
  for (const { q, trucks } of cases) {
    const state = { onHand: 0, pipeline: [0, 0] };
    const { result } = advancePeriod(state, config, 0, q);
    assert.equal(result.orderQty, q);
    assert.equal(result.trucks, trucks, `q=${q}`);
    assert.equal(result.transportCo2, trucks * config.co2PerTruck);
    assert.equal(result.truckCost, trucks * config.fixedCostPerTruck);
  }
});

test("truck fill percentage reflects utilization", () => {
  const state = { onHand: 0, pipeline: [0, 0] };
  const { result } = advancePeriod(state, config, 0, 150);
  assert.equal(result.trucks, 2);
  assert.equal(result.truckFillPct, 75);
});

test("holding cost and storage CO2 are charged on ending on-hand", () => {
  const state = { onHand: 100, pipeline: [0, 0] };
  const { result } = advancePeriod(state, config, 40, 0);
  assert.equal(result.onHandEnd, 60);
  assert.equal(result.holdingCost, 60 * config.holdingCost);
  assert.equal(result.storageCo2, 60 * config.co2PerUnitHeld);
});

test("profit = revenue - purchase - holding - trucks; purchase charged at order time", () => {
  const state = { onHand: 100, pipeline: [0, 0] };
  const { result } = advancePeriod(state, config, 80, 180);
  // sold 80, onHandEnd 20, q 180, trucks 2
  const expected =
    80 * config.price -
    180 * config.unitCost -
    20 * config.holdingCost -
    2 * config.fixedCostPerTruck;
  assert.equal(result.profit, expected);
  assert.equal(result.co2, result.transportCo2 + result.storageCo2);
});

test("zero demand, zero order: only holding and storage CO2 accrue", () => {
  const state = { onHand: 50, pipeline: [0, 0] };
  const { result } = advancePeriod(state, config, 0, 0);
  assert.equal(result.revenue, 0);
  assert.equal(result.orderQty, 0);
  assert.equal(result.profit, -(50 * config.holdingCost));
  assert.equal(result.co2, 50 * config.co2PerUnitHeld);
});

test("state object is not mutated", () => {
  const state = { onHand: 100, pipeline: [10, 20] };
  advancePeriod(state, config, 50, 120);
  assert.deepEqual(state, { onHand: 100, pipeline: [10, 20] });
});
