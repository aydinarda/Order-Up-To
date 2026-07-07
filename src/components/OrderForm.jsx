import { useState } from "react";

// The player decides the order quantity q directly. On-hand and in-transit are
// shown so they can reason about the pipeline (and avoid over-ordering what is
// already on the way) — but the game does not do that subtraction for them.
function OrderForm({ onSubmit, disabled, onHand = 0, inTransit = 0, config }) {
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState("");

  const inventoryPosition = onHand + inTransit;
  const parsed = Number(quantity);
  const isValid = quantity !== "" && Number.isInteger(parsed) && parsed >= 0;
  const truckCapacity = config?.truckCapacity || 0;
  const trucks =
    isValid && parsed > 0 && truckCapacity > 0 ? Math.ceil(parsed / truckCapacity) : 0;
  const fill = trucks > 0 ? Math.round((parsed / (trucks * truckCapacity)) * 100) : null;

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!isValid) {
      setError("Please enter a non-negative integer quantity.");
      return;
    }

    setError("");
    onSubmit(parsed);
  };

  return (
    <section className="card">
      <h3>Order Decision</h3>

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
        <label htmlFor="order-qty">Order quantity (units)</label>
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
              ? `${trucks} truck${trucks === 1 ? "" : "s"}` +
                (fill !== null ? ` (${fill}% full)` : "") +
                ` — arrives in ${config?.leadTime ?? 0} round${(config?.leadTime ?? 0) === 1 ? "" : "s"}`
              : "No order this round — shelves run down from stock on hand."}
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
