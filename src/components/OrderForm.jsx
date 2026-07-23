import { useState } from "react";

// The player decides the order quantities directly. On-hand and in-transit are
// shown so they can reason about the pipeline (and avoid over-ordering what is
// already on the way) — but the game does not do that subtraction for them.
// On the priming round (round 1) the opening order arrives in 1 round instead
// of the configured lead time, and there is no demand.
//
// Both delivery legs can be used in the same round: the consolidated truck
// (cheaper, lower CO2, full lead time) carries one quantity, and the express
// van (arrives next round, but smaller, pricier and dirtier per kg — for
// rescuing a stockout) carries another. Either can be zero.
function OrderForm({ onSubmit, disabled, onHand = 0, inTransit = 0, config, priming = false }) {
  const [truckQty, setTruckQty] = useState("");
  const [expressQty, setExpressQty] = useState("");
  const [error, setError] = useState("");

  const inventoryPosition = onHand + inTransit;

  // Empty input means 0 for that leg; anything typed must be a non-negative int.
  const parseLeg = (raw) => {
    if (raw === "") return 0;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  };
  const parsedTruck = parseLeg(truckQty);
  const parsedExpress = parseLeg(expressQty);
  const isValid = parsedTruck !== null && parsedExpress !== null;

  const truckLead = priming ? 1 : config?.leadTime ?? 0;

  const legs = config
    ? [
        {
          id: "consolidated",
          label: "Consolidated truck",
          icon: "🚚",
          tag: "Efficient",
          word: "truck",
          cap: config.truckCapacity,
          cost: config.fixedCostPerTruck,
          co2: config.co2PerTruck,
          lead: truckLead,
          qty: parsedTruck,
          rawValue: truckQty,
          onChange: setTruckQty
        },
        {
          id: "express",
          label: "Express van",
          icon: "🚐",
          tag: "Fast · costly",
          word: "van",
          cap: config.expressCapacity,
          cost: config.expressFixedCost,
          co2: config.expressCo2,
          lead: 1,
          qty: parsedExpress,
          rawValue: expressQty,
          onChange: setExpressQty
        }
      ].map((leg) => {
        const vehicles = leg.qty > 0 && leg.cap > 0 ? Math.ceil(leg.qty / leg.cap) : 0;
        return {
          ...leg,
          vehicles,
          fill: vehicles > 0 ? Math.round((leg.qty / (vehicles * leg.cap)) * 100) : null
        };
      })
    : [];

  const totalQty = (parsedTruck ?? 0) + (parsedExpress ?? 0);

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!isValid) {
      setError("Quantities must be non-negative integers.");
      return;
    }

    setError("");
    onSubmit(parsedTruck, parsedExpress);
  };

  return (
    <section className="card">
      <h3>{priming ? "Opening Order" : "Order Decision"}</h3>

      {priming && (
        <p className="order-preview">
          Priming round — no sales yet. Place your opening order to stock the
          city hub; it arrives next round.
        </p>
      )}

      <div className="inventory-strip">
        <div className="inventory-stat">
          <span className="inventory-label">On hand</span>
          <span className="inventory-value">{onHand}</span>
        </div>
        <div className="inventory-stat">
          <span className="inventory-label">In transit</span>
          <span className="inventory-value">{inTransit}</span>
        </div>
        <div className="inventory-stat">
          <span className="inventory-label">Inventory position</span>
          <span className="inventory-value">{inventoryPosition}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="order-form">
        {legs.length > 0 && (
          <div className="delivery-modes">
            {legs.map((leg) => (
              <div key={leg.id} className={`delivery-mode ${leg.qty > 0 ? "selected" : ""}`}>
                <span className="delivery-mode-head">
                  <span className="delivery-mode-icon" aria-hidden="true">{leg.icon}</span>
                  <span className="delivery-mode-name">{leg.label}</span>
                  <span className={`delivery-mode-tag tag-${leg.id}`}>{leg.tag}</span>
                </span>
                <span className="delivery-mode-detail">
                  {leg.cap} u/{leg.word} · arrives in {leg.lead} round{leg.lead === 1 ? "" : "s"}
                </span>
                <span className="delivery-mode-detail">
                  ${leg.cost} · {leg.co2} kg CO₂ each
                </span>
                <label htmlFor={`order-qty-${leg.id}`}>
                  {leg.label} quantity (kg)
                  <input
                    id={`order-qty-${leg.id}`}
                    type="number"
                    min="0"
                    step="1"
                    value={leg.rawValue}
                    placeholder="0"
                    onChange={(event) => leg.onChange(event.target.value)}
                    disabled={disabled}
                  />
                </label>
                {leg.qty > 0 && (
                  <span className="delivery-mode-detail">
                    {leg.vehicles} {leg.word}
                    {leg.vehicles === 1 ? "" : "s"}
                    {leg.fill !== null ? ` (${leg.fill}% full)` : ""} — arrives in {leg.lead}{" "}
                    round{leg.lead === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {isValid && (
          <p className="order-preview">
            {totalQty > 0
              ? `Total order: ${totalQty} kg`
              : priming
                ? "No opening order — you'll start round 2 with an empty hub."
                : "No order this round — the hub runs down from stock on hand."}
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={disabled}>
          Submit Order
        </button>
      </form>
    </section>
  );
}

export default OrderForm;
