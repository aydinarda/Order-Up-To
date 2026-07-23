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
// Every later order uses the configured lead time L, which the admin may raise
// or lower between rounds — supply conditions shift mid-season. An in-flight
// order always keeps the arrival time it shipped with; only new orders feel
// the change.
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
//
// Delivery modes (the storyline's central trade-off): each round the player
// can split the order across BOTH vehicles at once:
//   - "consolidated" truck — big capacity, cheaper + lower CO2 per vehicle, but
//     the full configured lead time L; and/or
//   - "express" van — always arrives in EXPRESS_LEAD_TIME (1 round) to rescue a
//     stockout, but smaller capacity and strictly higher cost + CO2 per vehicle,
//     so it is both more expensive and dirtier per kg. Use it sparingly.
// The split only changes vehicle economics and arrival timing; everything else
// (holding, storage CO2, lost sales) is identical.

// Express always arrives the round after it's placed. Not admin-configurable —
// the whole point of express is a fixed, fast lead time.
export const EXPRESS_LEAD_TIME = 1;

export const DEFAULT_CONFIG = {
  leadTime: 2,
  price: 40,
  unitCost: 10,
  holdingCost: 1,
  truckCapacity: 100,
  fixedCostPerTruck: 50,
  co2PerTruck: 100,
  co2PerUnitHeld: 0.5,
  delayProbability: 0,
  // Express van: smaller trucks that each cost more and emit more, so relying on
  // them erodes both profit and the sustainability KPI.
  expressCapacity: 40,
  expressFixedCost: 120,
  expressCo2: 250
};

export function createInitialState(config = DEFAULT_CONFIG) {
  return {
    onHand: 0,
    pipeline: Array.from({ length: config.leadTime + 1 }, () => 0)
  };
}

// options:
//   leadTime — periods until the CONSOLIDATED part of this order arrives
//              (defaults to config.leadTime; the round-1 opening order passes
//              1). The express part always arrives in EXPRESS_LEAD_TIME.
//   expressQty — units additionally shipped by express van this round (default
//                0). Both vehicles can be used in the same round: `order` rides
//                the consolidated truck, `expressQty` rides the express van.
//   priming — round 1: no demand is realized, no sales, no lost sales
//   delayed — a shared shipping-delay event hit this round: nothing arrives,
//             nothing already in the pipeline advances, and this round's
//             orders are queued one slot deeper to compensate
export function advancePeriod(state, config, demand, order, options = {}) {
  const orderLeadTime = options.leadTime ?? config.leadTime;
  const priming = options.priming ?? false;
  const delayed = options.delayed ?? false;

  const consolidatedQty = Math.max(0, order); // placed directly by the player
  const expressQty = Math.max(0, options.expressQty ?? 0);
  const orderQty = consolidatedQty + expressQty;

  const arrival = delayed ? 0 : state.pipeline[0] ?? 0;
  const available = state.onHand + arrival;

  const sold = priming ? 0 : Math.min(available, demand);
  const lost = priming ? 0 : Math.max(0, demand - available);
  const onHandEnd = available - sold;

  const trucks = consolidatedQty > 0 ? Math.ceil(consolidatedQty / config.truckCapacity) : 0;
  const vans = expressQty > 0 ? Math.ceil(expressQty / config.expressCapacity) : 0;

  // On a normal round, the pipeline shifts forward by one; the consolidated
  // order lands at (leadTime - 1) and the express order at slot 0 (next round).
  // On a delayed round, nothing shifts (everything already in transit —
  // including what was due this round — just waits one more round), and both
  // orders land one slot deeper so each still needs exactly its own lead time
  // of normal rounds once the freeze lifts.
  //
  // The admin can raise leadTime mid-game, so the pipeline may be shorter than
  // this order now needs — grow it with empty slots (never truncate: orders
  // already in flight keep the arrival time they shipped with).
  const shifted = delayed ? [...state.pipeline] : [...state.pipeline.slice(1), 0];
  while (shifted.length < orderLeadTime + 1) {
    shifted.push(0);
  }
  const consolidatedSlot = delayed ? orderLeadTime : Math.max(orderLeadTime - 1, 0);
  shifted[consolidatedSlot] += consolidatedQty;
  const expressSlot = delayed ? EXPRESS_LEAD_TIME : EXPRESS_LEAD_TIME - 1;
  shifted[expressSlot] += expressQty;

  const inTransitRemaining = shifted.reduce((sum, qty) => sum + qty, 0) - orderQty;
  const inventoryPosition = onHandEnd + inTransitRemaining;

  const revenue = sold * config.price;
  const purchaseCost = orderQty * config.unitCost;
  const holdingCost = onHandEnd * config.holdingCost;
  const truckCost = trucks * config.fixedCostPerTruck + vans * config.expressFixedCost;
  const profit = revenue - purchaseCost - holdingCost - truckCost;

  const transportCo2 = trucks * config.co2PerTruck + vans * config.expressCo2;
  const storageCo2 = onHandEnd * config.co2PerUnitHeld;

  // Total vehicle capacity dispatched this round — lets the leaderboard compute
  // an accurate fleet utilisation across a mix of consolidated + express legs.
  const capacityUnits = trucks * config.truckCapacity + vans * config.expressCapacity;

  // Label kept for round history / DB logs and the result screen.
  const mode =
    expressQty > 0 ? (consolidatedQty > 0 ? "mixed" : "express") : "consolidated";

  const nextState = { onHand: onHandEnd, pipeline: shifted };

  return {
    nextState,
    result: {
      priming,
      delayed,
      mode,
      arrival,
      demand: priming ? null : demand,
      sold,
      lost,
      onHandEnd,
      inTransitEnd: inTransitRemaining + orderQty,
      inventoryPosition,
      orderQty,
      consolidatedQty,
      expressQty,
      trucks,
      vans,
      vehicles: trucks + vans,
      capacityUnits,
      truckFillPct: orderQty > 0 && capacityUnits > 0 ? (orderQty / capacityUnits) * 100 : null,
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
