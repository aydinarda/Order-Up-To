import { useState } from "react";

function OrderForm({ onSubmit, disabled }) {
  const [quantity, setQuantity] = useState(100);
  const [error, setError] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    const parsed = Number(quantity);

    if (!Number.isInteger(parsed) || parsed <= 0) {
      setError("Please enter a positive integer quantity.");
      return;
    }

    setError("");
    onSubmit(parsed);
  };

  return (
    <section className="card">
      <h3>Order Decision</h3>
      <form onSubmit={handleSubmit} className="order-form">
        <label htmlFor="quantity">Order quantity (units)</label>
        <input
          id="quantity"
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          disabled={disabled}
        />

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={disabled}>
          Submit Order
        </button>
      </form>
    </section>
  );
}

export default OrderForm;
