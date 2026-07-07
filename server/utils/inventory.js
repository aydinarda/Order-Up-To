// Per-period state transition for the multi-period inventory game.
//
// The player decides the order quantity q directly each round (a Beer-Game-style
// decision): q units are shipped now and arrive after the lead time. Inventory
// position (on-hand + in-transit) is surfaced for context but is NOT used to
// derive q — reading the pipeline and not over-ordering is the player's job.
//
// Pipeline convention (the off-by-one guard): pipeline has length L;
// pipeline[0] is the shipment that arrives at the START of the next processed
// period. Each period we shift the arrival off the front and push the new
// order q at the back — so an order placed in round t arrives at the start of
// round t + L.
//
// Period sequence (fixed, documented once):
//   1. receive pipeline[0] into on-hand
//   2. realize demand: sold = min(onHand, d), lost = d - sold (lost sales, no backorders)
//   3. place the order q (given); trucks = ceil(q / capacity); push q into the pipeline
//   4. charge financials and emissions
//
// Purchase cost is charged at order time (q * unitCost), so end-of-game
// leftovers are sunk — no salvage step.

export const DEFAULT_CONFIG = {
  leadTime: 2,
  price: 40,
  unitCost: 10,
  holdingCost: 1,
  truckCapacity: 100,
  fixedCostPerTruck: 50,
  co2PerTruck: 100,
  co2PerUnitHeld: 0.5,
  // ~ one protection interval (L+1 rounds) of mean demand: round 1 is not a
  // scripted stockout, but replenishment kicks in within the first rounds.
  startingOnHand: 300
};

export function createInitialState(config = DEFAULT_CONFIG) {
  return {
    onHand: config.startingOnHand,
    pipeline: Array.from({ length: config.leadTime }, () => 0)
  };
}

export function advancePeriod(state, config, demand, order) {
  const arrival = state.pipeline.length > 0 ? state.pipeline[0] : 0;
  const remainingPipeline = state.pipeline.slice(1);

  const available = state.onHand + arrival;
  const sold = Math.min(available, demand);
  const lost = Math.max(0, demand - available);
  const onHandEnd = available - sold;

  const inTransit = remainingPipeline.reduce((sum, qty) => sum + qty, 0);
  const inventoryPosition = onHandEnd + inTransit; // informational (shown to the player)
  const orderQty = Math.max(0, order); // placed directly by the player
  const trucks = orderQty > 0 ? Math.ceil(orderQty / config.truckCapacity) : 0;

  const revenue = sold * config.price;
  const purchaseCost = orderQty * config.unitCost;
  const holdingCost = onHandEnd * config.holdingCost;
  const truckCost = trucks * config.fixedCostPerTruck;
  const profit = revenue - purchaseCost - holdingCost - truckCost;

  const transportCo2 = trucks * config.co2PerTruck;
  const storageCo2 = onHandEnd * config.co2PerUnitHeld;

  const pipeline = config.leadTime > 0 ? [...remainingPipeline, orderQty] : [];
  // Lead time 0: the order arrives immediately, but only next period's demand
  // can consume it — it still lands in on-hand after this period's sales.
  const nextState = {
    onHand: config.leadTime > 0 ? onHandEnd : onHandEnd + orderQty,
    pipeline
  };

  return {
    nextState,
    result: {
      arrival,
      demand,
      sold,
      lost,
      onHandEnd,
      inTransitEnd: inTransit + (config.leadTime > 0 ? orderQty : 0),
      inventoryPosition,
      orderQty,
      trucks,
      truckFillPct: trucks > 0 ? (orderQty / (trucks * config.truckCapacity)) * 100 : null,
      revenue,
      purchaseCost,
      holdingCost,
      truckCost,
      profit,
      transportCo2,
      storageCo2,
      co2: transportCo2 + storageCo2
    }
  };
}
