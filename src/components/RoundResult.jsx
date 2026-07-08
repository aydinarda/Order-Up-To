function toCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatCo2(value) {
  return `${Math.round(value * 10) / 10} kg`;
}

function RoundResult({ result }) {
  if (!result) {
    return null;
  }

  const demandValue = result.realizedDemand ?? result.demand;

  return (
    <section className="card result-card">
      <h3>{result.priming ? "Opening Round" : "Round Result"}</h3>
      {result.priming && (
        <p className="muted-text">Priming round — no sales. Your opening order is on its way.</p>
      )}
      {result.delayed && (
        <p className="delay-banner">
          ⛈️ Shipping delay this round — every shipment in transit was held up, including any
          order placed this round.
        </p>
      )}
      <div className="result-grid">
        <p>Shipment arrived</p>
        <strong>{result.arrival}</strong>

        <p>Realized demand</p>
        <strong>{result.priming || demandValue == null ? "—" : demandValue}</strong>

        <p>Sold units</p>
        <strong>{result.sold}</strong>

        <p>Lost sales</p>
        <strong className={result.lost > 0 ? "loss-text" : undefined}>{result.lost}</strong>

        <p>Ending on-hand</p>
        <strong>{result.onHandEnd}</strong>

        <p>Order placed (q)</p>
        <strong>{result.orderQty}</strong>

        <p>Trucks</p>
        <strong>
          {result.trucks}
          {result.truckFillPct !== null && result.trucks > 0
            ? ` (${Math.round(result.truckFillPct)}% full)`
            : ""}
        </strong>

        <p>Revenue</p>
        <strong>{toCurrency(result.revenue)}</strong>

        <p>Purchase cost</p>
        <strong>{toCurrency(result.purchaseCost)}</strong>

        <p>Holding cost</p>
        <strong>{toCurrency(result.holdingCost)}</strong>

        <p>Truck cost</p>
        <strong>{toCurrency(result.truckCost)}</strong>

        <p>Transport CO₂</p>
        <strong>{formatCo2(result.transportCo2)}</strong>

        <p>Storage CO₂</p>
        <strong>{formatCo2(result.storageCo2)}</strong>
      </div>
      <p className="profit-line">Round profit: {toCurrency(result.profit)}</p>
      <p className="co2-line">Round CO₂: {formatCo2(result.co2)}</p>
    </section>
  );
}

export default RoundResult;
