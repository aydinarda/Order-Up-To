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
// Pipeline convention (the off-by-one guard): pipeline has length L + 1 — one
// extra "reserve" slot beyond the normal horizon, held for shipping-delay
// events (see below). Entry i is the quantity arriving in (i+1) periods. Each
// period we shift the front off (this period's arrival) and place the new
// order at slot (leadTime-1) — so a normal order placed in round t arrives at
// the start of round t + L, and the opening order (lead time 1) arrives at the
// start of round 2.
//
// Shipping-delay events (admin-configurable, shared across all players — see
// config.delayProbability in server/index.js): when a round is flagged
// `delayed`, NOTHING progresses that round. Whatever was due to arrive stays
// in transit (arrival = 0, pipeline is not shifted), and this round's new
// order is placed one slot deeper than usual to account for the frozen round —
// it lands where it would have landed had the round advanced normally, then
// waits out the freeze just like everything else already in the pipeline.
// This is why the pipeline carries one slot of headroom beyond leadTime.
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
  delayProbability: 0
};

export function createInitialState(config = DEFAULT_CONFIG) {
  return {
    onHand: 0,
    pipeline: Array.from({ length: config.leadTime + 1 }, () => 0)
  };
}

// options:
//   leadTime — periods until this order arrives (defaults to config.leadTime;
//              the round-1 opening order passes 1)
//   priming — round 1: no demand is realized, no sales, no lost sales
//   delayed — a shared shipping-delay event hit this round: nothing arrives,
//             nothing already in the pipeline advances, and this round's order
//             is queued one slot deeper to compensate
export function advancePeriod(state, config, demand, order, options = {}) {
  const orderLeadTime = options.leadTime ?? config.leadTime;
  const priming = options.priming ?? false;
  const delayed = options.delayed ?? false;

  const arrival = delayed ? 0 : state.pipeline[0] ?? 0;
  const available = state.onHand + arrival;

  const sold = priming ? 0 : Math.min(available, demand);
  const lost = priming ? 0 : Math.max(0, demand - available);
  const onHandEnd = available - sold;

  const orderQty = Math.max(0, order); // placed directly by the player
  const trucks = orderQty > 0 ? Math.ceil(orderQty / config.truckCapacity) : 0;

  // On a normal round, the pipeline shifts forward by one and the order lands
  // at (leadTime - 1). On a delayed round, nothing shifts (everything already
  // in transit — including what was due this round — just waits one more
  // round), and the new order lands one slot deeper so it still needs exactly
  // `orderLeadTime` normal rounds once the freeze lifts.
  const maxSlot = state.pipeline.length - 1;
  const shifted = delayed ? [...state.pipeline] : [...state.pipeline.slice(1), 0];
  const slot = delayed
    ? Math.min(orderLeadTime, maxSlot)
    : Math.min(Math.max(orderLeadTime - 1, 0), maxSlot);
  shifted[slot] += orderQty;

  const inTransitRemaining = shifted.reduce((sum, qty) => sum + qty, 0) - orderQty;
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
      delayed,
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
