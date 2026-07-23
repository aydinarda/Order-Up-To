import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advancePeriod,
  createInitialState,
  DEFAULT_CONFIG
} from "../../../server/utils/inventory.js";

const config = { ...DEFAULT_CONFIG, leadTime: 2 };

test("initial state is an empty warehouse with a pipeline of length L+1 (reserve slot for delays)", () => {
  const state = createInitialState(config);
  assert.equal(state.onHand, 0);
  assert.deepEqual(state.pipeline, [0, 0, 0]);
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
  assert.deepEqual(nextState.pipeline, [150, 0, 0]);

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
  assert.deepEqual(step.nextState.pipeline, [0, 100, 0]);

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
  // The short hand-built pipeline grows so the order still takes leadTime 2.
  assert.deepEqual(nextState.pipeline, [30, 160, 0]);
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

// ── Shipping-delay events ──────────────────────────────────────────────────
// A delayed round freezes the whole pipeline: nothing arrives (even if
// something was due), nothing shifts, and the new order is queued one slot
// deeper so it still needs a full `orderLeadTime` of normal rounds once the
// freeze lifts. This is why the pipeline is sized leadTime+1.

test("a delayed round delivers nothing, even if a shipment was due", () => {
  const state = { onHand: 20, pipeline: [80, 0, 0] }; // 80 was due this round
  const { nextState, result } = advancePeriod(state, config, 50, 0, { delayed: true });
  assert.equal(result.delayed, true);
  assert.equal(result.arrival, 0); // the due shipment does NOT arrive
  assert.equal(result.sold, 20); // only pre-existing on-hand can be sold
  assert.equal(result.lost, 30);
  // Nothing shifted: the 80 units are still exactly one round away.
  assert.deepEqual(nextState.pipeline, [80, 0, 0]);
});

test("an order placed during a delayed round lands one slot deeper", () => {
  const state = createInitialState(config); // pipeline [0,0,0], leadTime 2
  const { nextState } = advancePeriod(state, config, 0, 90, { delayed: true });
  // Normal (non-delayed) placement would be slot (leadTime-1)=1; delayed -> slot leadTime=2.
  assert.deepEqual(nextState.pipeline, [0, 0, 90]);
});

test("a delayed shipment arrives exactly one round later than normal", () => {
  let state = createInitialState(config); // leadTime 2

  // Round 1 (normal): order 100. Would normally arrive round 3.
  let step = advancePeriod(state, config, 0, 100);
  state = step.nextState;

  // Round 2: a delay hits. Nothing progresses.
  step = advancePeriod(state, config, 0, 0, { delayed: true });
  assert.equal(step.result.arrival, 0);
  state = step.nextState;

  // Round 3: would have been the normal arrival round — still nothing, because
  // round 2's freeze pushed everything back by one.
  step = advancePeriod(state, config, 0, 0);
  assert.equal(step.result.arrival, 0);
  state = step.nextState;

  // Round 4: the delayed shipment finally arrives.
  step = advancePeriod(state, config, 0, 0);
  assert.equal(step.result.arrival, 100);
});

test("back-to-back delayed rounds do not throw and keep a fixed pipeline length", () => {
  let state = createInitialState(config);
  let step = advancePeriod(state, config, 0, 60, { delayed: true });
  state = step.nextState;
  step = advancePeriod(state, config, 0, 40, { delayed: true });
  assert.equal(step.nextState.pipeline.length, config.leadTime + 1);
  assert.equal(step.nextState.pipeline.reduce((s, q) => s + q, 0), 100);
});

// ── Mid-game lead-time changes ─────────────────────────────────────────────
// The admin can raise or lower leadTime between rounds. In-flight orders keep
// the arrival time they shipped with; only new orders use the new lead time.

test("raising leadTime mid-game grows the pipeline; the in-flight order keeps its arrival", () => {
  let state = createInitialState(config); // leadTime 2, pipeline [0,0,0]

  // Round t: order 100 under leadTime 2 -> slot 1.
  let step = advancePeriod(state, config, 0, 100);
  assert.deepEqual(step.nextState.pipeline, [0, 100, 0]);
  state = step.nextState;

  // Admin raises leadTime to 4. Round t+1: new order 70 lands at slot 3 — the
  // pipeline grows to reach it — while the old 100 shifts forward untouched.
  const longer = { ...config, leadTime: 4 };
  step = advancePeriod(state, longer, 0, 70);
  assert.deepEqual(step.nextState.pipeline, [100, 0, 0, 70, 0]);

  // Round t+2: the old order arrives on its original schedule.
  step = advancePeriod(step.nextState, longer, 0, 0);
  assert.equal(step.result.arrival, 100);
});

test("lowering leadTime mid-game lets a new order overtake the pipeline's extra slots", () => {
  const longer = { ...config, leadTime: 4 };
  let state = createInitialState(longer); // pipeline [0,0,0,0,0]

  // Round t: order 100 under leadTime 4 -> slot 3.
  let step = advancePeriod(state, longer, 0, 100);
  assert.deepEqual(step.nextState.pipeline, [0, 0, 0, 100, 0]);
  state = step.nextState;

  // Admin lowers leadTime to 2. New order 50 lands at slot 1; trailing slots
  // stay (harmless zeros) and the old 100 keeps its original arrival round.
  step = advancePeriod(state, config, 0, 50);
  assert.deepEqual(step.nextState.pipeline, [0, 50, 100, 0, 0]);
});

// ── Delivery legs: consolidated and/or express in the same round ───────────
// Express uses smaller vans that each cost more and emit more, and it arrives
// the SAME round it is ordered (it never enters the pipeline). The player can
// ship BOTH legs in one round: `order` rides the truck, options.expressQty
// rides the van.

test("an order without expressQty is a pure consolidated round", () => {
  const state = createInitialState(config);
  const { result } = advancePeriod(state, config, 0, 100);
  assert.equal(result.mode, "consolidated");
  assert.equal(result.trucks, 1); // 100 / truckCapacity 100
  assert.equal(result.vans, 0);
  assert.equal(result.transportCo2, config.co2PerTruck);
  assert.equal(result.truckCost, config.fixedCostPerTruck);
});

test("a pure express order uses van capacity, cost and CO2 — strictly worse per kg", () => {
  const state = createInitialState(config);
  // 120 units: consolidated -> ceil(120/100)=2 trucks; express -> ceil(120/40)=3 vans.
  const consolidated = advancePeriod(state, config, 0, 120).result;
  const express = advancePeriod(state, config, 0, 0, { expressQty: 120 }).result;

  assert.equal(express.mode, "express");
  assert.equal(express.trucks, 0);
  assert.equal(express.vans, 3);
  assert.equal(express.truckCost, 3 * config.expressFixedCost);
  assert.equal(express.transportCo2, 3 * config.expressCo2);
  // Express must be both pricier and dirtier for the same order.
  assert.ok(express.truckCost > consolidated.truckCost);
  assert.ok(express.transportCo2 > consolidated.transportCo2);
});

test("mixed round: transport cost is the sum of the truck and van fleets", () => {
  const state = createInitialState(config);
  // 250 consolidated -> 3 trucks; 90 express -> 3 vans.
  const { result } = advancePeriod(state, config, 0, 250, { expressQty: 90 });
  assert.equal(result.mode, "mixed");
  assert.equal(result.orderQty, 340);
  assert.equal(result.trucks, 3);
  assert.equal(result.vans, 3);
  assert.equal(result.vehicles, 6);
  assert.equal(
    result.truckCost,
    3 * config.fixedCostPerTruck + 3 * config.expressFixedCost
  );
  // Purchase cost covers the combined quantity.
  assert.equal(result.purchaseCost, 340 * config.unitCost);
});

test("mixed round: transport CO2 is the sum of the truck and van fleets", () => {
  const state = createInitialState(config);
  const { result } = advancePeriod(state, config, 0, 250, { expressQty: 90 });
  assert.equal(result.transportCo2, 3 * config.co2PerTruck + 3 * config.expressCo2);
  // The express 90 landed this round and (with zero demand) is now held, so
  // storage CO2 covers it; the consolidated 250 is still in transit.
  assert.equal(result.storageCo2, 90 * config.co2PerUnitHeld);
  assert.equal(result.co2, result.transportCo2 + result.storageCo2);
});

test("mixed round: express leg arrives this round, consolidated leg after leadTime rounds", () => {
  let state = createInitialState(config); // leadTime 2
  // 200 by truck (arrives in 2 rounds), 80 by van (lands immediately).
  let step = advancePeriod(state, config, 0, 200, { expressQty: 80 });
  assert.equal(step.result.arrival, 80); // the express quantity, this round
  assert.equal(step.nextState.onHand, 80); // zero demand -> held
  assert.deepEqual(step.nextState.pipeline, [0, 200, 0]); // only the truck in transit
  state = step.nextState;

  // Next round: nothing due yet.
  step = advancePeriod(state, config, 0, 0);
  assert.equal(step.result.arrival, 0);
  state = step.nextState;

  // The round after: the consolidated quantity lands, completing the order.
  step = advancePeriod(state, config, 0, 0);
  assert.equal(step.result.arrival, 200);
  assert.equal(step.nextState.onHand, 280);
});

test("express serves this round's demand — a same-round stockout rescue", () => {
  const longer = { ...config, leadTime: 4 };
  const state = createInitialState(longer); // empty warehouse, nothing inbound
  // Demand 30 hits an empty hub; 40 by express van covers it immediately.
  const { result, nextState } = advancePeriod(state, longer, 30, 0, { expressQty: 40 });
  assert.equal(result.arrival, 40);
  assert.equal(result.sold, 30);
  assert.equal(result.lost, 0);
  assert.equal(nextState.onHand, 10); // the unsold remainder is held
});

test("a delayed round freezes the pipeline but not the express van", () => {
  const state = createInitialState(config); // pipeline [0,0,0], leadTime 2
  const { result, nextState } = advancePeriod(state, config, 0, 100, {
    expressQty: 40,
    delayed: true
  });
  // Consolidated queues one slot deeper (slot leadTime = 2); express landed.
  assert.deepEqual(nextState.pipeline, [0, 0, 100]);
  assert.equal(result.arrival, 40);
  assert.equal(nextState.onHand, 40);
});

test("capacityUnits and fill reflect the combined dispatched fleet", () => {
  const state = createInitialState(config);
  // 50 express units over 40-unit vans -> 2 vans, 80 capacity, 62.5% full.
  const pureExpress = advancePeriod(state, config, 0, 0, { expressQty: 50 }).result;
  assert.equal(pureExpress.vans, 2);
  assert.equal(pureExpress.capacityUnits, 2 * config.expressCapacity);
  assert.equal(pureExpress.truckFillPct, (50 / 80) * 100);

  // Mixed: 250 -> 3 trucks (300u) + 90 -> 3 vans (120u) = 420u for 340 ordered.
  const mixed = advancePeriod(state, config, 0, 250, { expressQty: 90 }).result;
  assert.equal(mixed.capacityUnits, 3 * config.truckCapacity + 3 * config.expressCapacity);
  assert.equal(mixed.truckFillPct, (340 / 420) * 100);
});
