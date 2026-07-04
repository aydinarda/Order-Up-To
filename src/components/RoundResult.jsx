function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function RoundResult({ result }) {
  if (!result) {
    return null;
  }

  return (
    <section className="card result-card">
      <h3>Round Result</h3>
      <div className="result-grid">
        <p>Order quantity</p>
        <strong>{result.orderQuantity}</strong>

        <p>Realized demand</p>
        <strong>{result.realizedDemand}</strong>

        <p>Sold units</p>
        <strong>{result.soldUnits}</strong>

        <p>Unsold units</p>
        <strong>{result.unsoldUnits}</strong>

        <p>Revenue</p>
        <strong>{toCurrency(result.revenue)}</strong>

        <p>Salvage value</p>
        <strong>{toCurrency(result.salvageValue)}</strong>

        <p>Total cost</p>
        <strong>{toCurrency(result.totalCost)}</strong>
      </div>
      <p className="profit-line">Round profit: {toCurrency(result.profit)}</p>
    </section>
  );
}

export default RoundResult;
