import { useState } from "react";

// The preview deliberately shows only the consequences of S (order size, trucks,
// fill rate) — never a suggested S*, so students aren't anchored to the answer.
function OrderForm({ onSubmit, disabled, onHand = 0, inTransit = 0, config }) {
  const [level, setLevel] = useState("");
  const [error, setError] = useState("");

  const inventoryPosition = onHand + inTransit;
  const parsed = Number(level);
  const isValid = level !== "" && Number.isInteger(parsed) && parsed >= 0;
  const previewQty = isValid ? Math.max(0, parsed - inventoryPosition) : null;
  const truckCapacity = config?.truckCapacity || 0;
  const previewTrucks =
    previewQty !== null && previewQty > 0 && truckCapacity > 0
      ? Math.ceil(previewQty / truckCapacity)
      : 0;
  const previewFill =
    previewTrucks > 0 ? Math.round((previewQty / (previewTrucks * truckCapacity)) * 100) : null;

  const handleSubmit = (event) => {
    event.preventDefault();

    if (!isValid) {
      setError("Please enter a non-negative integer level.");
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
        <label htmlFor="order-up-to">Order-up-to level S</label>
        <input
          id="order-up-to"
          type="number"
          min="0"
          step="1"
          value={level}
          placeholder={String(inventoryPosition)}
          onChange={(event) => setLevel(event.target.value)}
          disabled={disabled}
        />

        {isValid && (
          <p className="order-preview">
            {previewQty > 0
              ? `You'd order ${previewQty} units = ${previewTrucks} truck${previewTrucks === 1 ? "" : "s"}` +
                (previewFill !== null ? ` (${previewFill}% full)` : "")
              : "No order this round — S is at or below your inventory position."}
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={disabled}>
          Submit Level
        </button>
      </form>
    </section>
  );
}

export default OrderForm;
