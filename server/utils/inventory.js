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
// Backorders (not lost sales): unmet demand waits. `onHand` is NET inventory —
// a negative value is the open backlog of customers still owed product. Every
// arrival (ship pipeline or express truck) first clears that backlog, and only
// the rest serves this round's demand. Revenue is booked on delivery, so a
// backordered unit earns its price in the round it is finally shipped (never,
// if the game ends first). Each round, every unit still backordered at the end
// of the round costs config.backorderCost — the mirror image of holding cost,
// which (like storage CO2) is charged only on positive stock.
//
// Delivery legs (the storyline's central trade-off): each round the player can
// split the order across BOTH vehicles at once:
//   - "consolidated" leg = ship — big capacity, cheaper + lower CO2 per vehicle,
//     but the full configured lead time L; and/or
//   - "express" leg = truck — arrives the SAME round it is ordered, so it can
//     rescue this round's demand from a stockout, but smaller capacity and
//     strictly higher cost + CO2 per vehicle: more expensive and dirtier per kg.
// The split only changes vehicle economics and arrival timing; everything else
// (holding, storage CO2, backorders) is identical.
//
// The express truck never touches the pipeline: it lands immediately — even
// during a shipping-delay event, which freezes only the ship pipeline. That
// guaranteed immediacy is exactly what its premium buys.
//
// The admin can switch the express truck off (config.expressEnabled). That rule
// is enforced by the server, not here: this engine prices whatever it is given,
// so the analysis scripts can compare both legs regardless of the toggle.

export const DEFAULT_CONFIG = {
  leadTime: 2,
  price: 40,
  unitCost: 10,
  holdingCost: 1,
  // $ per unit still backordered at the end of a round.
  backorderCost: 5,
  shipCapacity: 100,
  shipCost: 50,
  shipCo2: 100,
  co2PerUnitHeld: 0.5,
  delayProbability: 0,
  // Express truck: off unless the admin opens it. Smaller vehicles that each
  // cost more and emit more, so relying on them erodes both profit and the
  // sustainability KPI.
  expressEnabled: false,
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
//   leadTime — periods until the SHIP (consolidated) part of this order arrives
//              (defaults to config.leadTime; the round-1 opening order passes
//              1). The express part always arrives within the same round.
//   expressQty — units additionally shipped by express truck this round
//                (default 0). Both vehicles can be used in the same round:
//                `order` rides the ship, `expressQty` rides the express truck.
//   priming — round 1: no demand is realized, no sales, no backorders
//   delayed — a shared shipping-delay event hit this round: nothing arrives
//             from the pipeline, nothing already in it advances, and this
//             round's ship order is queued one slot deeper to
//             compensate. Express is unaffected — it still lands this round.
export function advancePeriod(state, config, demand, order, options = {}) {
  const orderLeadTime = options.leadTime ?? config.leadTime;
  const priming = options.priming ?? false;
  const delayed = options.delayed ?? false;

  const consolidatedQty = Math.max(0, order); // placed directly by the player
  const expressQty = Math.max(0, options.expressQty ?? 0);
  const orderQty = consolidatedQty + expressQty;

  // Express lands immediately — it can serve THIS round's demand. The delay
  // event freezes only the ship pipeline, never the direct truck.
  const pipelineArrival = delayed ? 0 : state.pipeline[0] ?? 0;
  const arrival = pipelineArrival + expressQty;

  // Arrivals first clear the backlog carried in from earlier rounds; whatever
  // net stock remains serves this round's demand, and the shortfall is
  // backordered (net inventory goes negative).
  const backlogStart = Math.max(0, -state.onHand);
  const net = state.onHand + arrival;
  const backlogFilled = Math.min(backlogStart, arrival);
  const roundDemand = priming ? 0 : demand;
  const servedOnTime = Math.min(roundDemand, Math.max(0, net));
  const newBackorders = roundDemand - servedOnTime;
  const onHandEnd = net - roundDemand;
  const stockEnd = Math.max(0, onHandEnd);
  const backorderEnd = Math.max(0, -onHandEnd);
  // Units shipped to customers this round (old backlog + today's demand).
  const sold = backlogFilled + servedOnTime;

  const ships = consolidatedQty > 0 ? Math.ceil(consolidatedQty / config.shipCapacity) : 0;
  const expressTrucks = expressQty > 0 ? Math.ceil(expressQty / config.expressCapacity) : 0;

  // On a normal round, the pipeline shifts forward by one and the consolidated
  // order lands at (leadTime - 1). On a delayed round, nothing shifts
  // (everything already in transit — including what was due this round — just
  // waits one more round), and the order lands one slot deeper so it still
  // needs exactly `orderLeadTime` normal rounds once the freeze lifts.
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

  const inTransitRemaining = shifted.reduce((sum, qty) => sum + qty, 0) - consolidatedQty;
  const inventoryPosition = onHandEnd + inTransitRemaining;

  const revenue = sold * config.price;
  const purchaseCost = orderQty * config.unitCost;
  const holdingCost = stockEnd * config.holdingCost;
  const backorderCost = backorderEnd * (config.backorderCost ?? 0);
  const transportCost = ships * config.shipCost + expressTrucks * config.expressFixedCost;
  const profit = revenue - purchaseCost - holdingCost - backorderCost - transportCost;

  const transportCo2 = ships * config.shipCo2 + expressTrucks * config.expressCo2;
  const storageCo2 = stockEnd * config.co2PerUnitHeld;

  // Total vehicle capacity dispatched this round — lets the leaderboard compute
  // an accurate fleet utilisation across a mix of ships and express trucks.
  const capacityUnits = ships * config.shipCapacity + expressTrucks * config.expressCapacity;

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
      servedOnTime,
      newBackorders,
      backlogFilled,
      backorderEnd,
      onHandEnd,
      inTransitEnd: inTransitRemaining + consolidatedQty,
      inventoryPosition,
      orderQty,
      consolidatedQty,
      expressQty,
      ships,
      expressTrucks,
      vehicles: ships + expressTrucks,
      capacityUnits,
      fleetFillPct: orderQty > 0 && capacityUnits > 0 ? (orderQty / capacityUnits) * 100 : null,
      revenue,
      purchaseCost,
      holdingCost,
      backorderCost,
      transportCost,
      profit,
      transportCo2,
      storageCo2,
      co2: transportCo2 + storageCo2
    }
  };
}
