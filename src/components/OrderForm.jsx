import { useState } from "react";

// The player decides the order quantity q directly. On-hand and in-transit are
// shown so they can reason about the pipeline (and avoid over-ordering what is
// already on the way) — but the game does not do that subtraction for them.
// On the priming round (round 1) the opening order arrives in 1 round instead
// of the configured lead time, and there is no demand.
//
// The player also picks a delivery mode: the consolidated truck (cheaper, lower
// CO2, full lead time) or the express van (arrives next round, but smaller,
// pricier and dirtier per kg — for rescuing a stockout).
function OrderForm({ onSubmit, disabled, onHand = 0, inTransit = 0, config, priming = false }) {
  const [quantity, setQuantity] = useState("");
  const [mode, setMode] = useState("consolidated");
  const [error, setError] = useState("");

  const inventoryPosition = onHand + inTransit;
  const parsed = Number(quantity);
  const isValid = quantity !== "" && Number.isInteger(parsed) && parsed >= 0;

  const isExpress = mode === "express";
  const capacity = (isExpress ? config?.expressCapacity : config?.truckCapacity) || 0;
  const arrivalRounds = isExpress ? 1 : priming ? 1 : config?.leadTime ?? 0;

  const vehicles = isValid && parsed > 0 && capacity > 0 ? Math.ceil(parsed / capacity) : 0;
  const fill = vehicles > 0 ? Math.round((parsed / (vehicles * capacity)) * 100) : null;
  const vehicleWord = isExpress ? "van" : "truck";

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!isValid) {
      setError("Please enter a non-negative integer quantity.");
      return;
    }

    setError("");
    onSubmit(parsed, mode);
  };

  const modeOptions = config
    ? [
        {
          id: "consolidated",
          label: "Consolidated truck",
          icon: "🚚",
          tag: "Efficient",
          cap: config.truckCapacity,
          cost: config.fixedCostPerTruck,
          co2: config.co2PerTruck,
          lead: priming ? 1 : config.leadTime
        },
        {
          id: "express",
          label: "Express van",
          icon: "🚐",
          tag: "Fast · costly",
          cap: config.expressCapacity,
          cost: config.expressFixedCost,
          co2: config.expressCo2,
          lead: 1
        }
      ]
    : [];

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

      {modeOptions.length > 0 && (
        <div className="delivery-modes" role="radiogroup" aria-label="Delivery mode">
          {modeOptions.map((opt) => (
            <button
              type="button"
              key={opt.id}
              role="radio"
              aria-checked={mode === opt.id}
              className={`delivery-mode ${mode === opt.id ? "selected" : ""}`}
              onClick={() => setMode(opt.id)}
              disabled={disabled}
            >
              <span className="delivery-mode-head">
                <span className="delivery-mode-icon" aria-hidden="true">{opt.icon}</span>
                <span className="delivery-mode-name">{opt.label}</span>
                <span className={`delivery-mode-tag tag-${opt.id}`}>{opt.tag}</span>
              </span>
              <span className="delivery-mode-detail">
                {opt.cap} u/{opt.id === "express" ? "van" : "truck"} · arrives in{" "}
                {opt.lead} round{opt.lead === 1 ? "" : "s"}
              </span>
              <span className="delivery-mode-detail">
                ${opt.cost} · {opt.co2} kg CO₂ each
              </span>
            </button>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="order-form">
        <label htmlFor="order-qty">Order quantity (kg)</label>
        <input
          id="order-qty"
          type="number"
          min="0"
          step="1"
          value={quantity}
          placeholder="0"
          onChange={(event) => setQuantity(event.target.value)}
          disabled={disabled}
        />

        {isValid && (
          <p className="order-preview">
            {parsed > 0
              ? `${vehicles} ${vehicleWord}${vehicles === 1 ? "" : "s"}` +
                (fill !== null ? ` (${fill}% full)` : "") +
                ` — arrives in ${arrivalRounds} round${arrivalRounds === 1 ? "" : "s"}`
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
