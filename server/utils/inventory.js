// Per-period state transition for the multi-period inventory game.
//
// The player decides the order quantity q directly each round (a Beer-Game-style
// decision): q units are shipped now and arrive after the lead time. Inventory
// position (on-hand + in-transit) is surfaced for context but is NOT used to
// derive q — reading the pipeline and not over-ordering is the player's job.
//
// The warehouse starts EMPTY (no starting stock). Round 1 is a priming round:
// no demand / no sales — the player just places an opening order, and that
// opening order arrives fast (lead time 1, i.e. at the start of round 2).
// Every later order uses the configured lead time L.
//
// Pipeline convention (the off-by-one guard): pipeline has length L; entry i is
// the quantity arriving in (i+1) periods. Each period we shift the front off
// (this period's arrival) and place the new order at slot (leadTime-1) — so a
// normal order placed in round t arrives at the start of round t + L, and the
// opening order (lead time 1) arrives at the start of round 2.
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
  co2PerUnitHeld: 0.5
};

export function createInitialState(config = DEFAULT_CONFIG) {
  return {
    onHand: 0,
    pipeline: Array.from({ length: config.leadTime }, () => 0)
  };
}

// options:
//   leadTime — periods until this order arrives (defaults to config.leadTime;
//              the round-1 opening order passes 1)
//   priming — round 1: no demand is realized, no sales, no lost sales
export function advancePeriod(state, config, demand, order, options = {}) {
  const orderLeadTime = options.leadTime ?? config.leadTime;
  const priming = options.priming ?? false;

  const arrival = state.pipeline.length > 0 ? state.pipeline[0] : 0;
  const available = state.onHand + arrival;

  const sold = priming ? 0 : Math.min(available, demand);
  const lost = priming ? 0 : Math.max(0, demand - available);
  const onHandEnd = available - sold;

  const orderQty = Math.max(0, order); // placed directly by the player
  const trucks = orderQty > 0 ? Math.ceil(orderQty / config.truckCapacity) : 0;

  // Shift the pipeline forward one period, then place the new order at the slot
  // matching its lead time. inTransit (for the informational IP) excludes the
  // order just placed, matching what the player saw when deciding.
  const shifted = [...state.pipeline.slice(1), 0];
  const inTransitRemaining = shifted.reduce((sum, qty) => sum + qty, 0);
  const slot = Math.min(Math.max(orderLeadTime - 1, 0), Math.max(shifted.length - 1, 0));
  if (shifted.length > 0) {
    shifted[slot] += orderQty;
  }

  const inventoryPosition = onHandEnd + inTransitRemaining;

  const revenue = sold * config.price;
  const purchaseCost = orderQty * config.unitCost;
  const holdingCost = onHandEnd * config.holdingCost;
  const truckCost = trucks * config.fixedCostPerTruck;
  const profit = revenue - purchaseCost - holdingCost - truckCost;

  const transportCo2 = trucks * config.co2PerTruck;
  const storageCo2 = onHandEnd * config.co2PerUnitHeld;

  const nextState = { onHand: onHandEnd, pipeline: shifted };

  return {
    nextState,
    result: {
      priming,
      arrival,
      demand: priming ? null : demand,
      sold,
      lost,
      onHandEnd,
      inTransitEnd: inTransitRemaining + orderQty,
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
