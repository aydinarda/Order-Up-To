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

// The order is split across the ship (consolidated leg) and the express truck;
// either may be zero. The truck row is only shown while the truck is available,
// or when this round actually used it.
function RoundResult({ result, expressEnabled = false }) {
  if (!result) {
    return null;
  }

  const demandValue = result.realizedDemand ?? result.demand;
  const { consolidatedQty, expressQty, ships, expressTrucks } = result;

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

        <p>Backorders filled</p>
        <strong>{result.backlogFilled}</strong>

        <p>New backorders</p>
        <strong className={result.newBackorders > 0 ? "loss-text" : undefined}>
          {result.newBackorders}
        </strong>

        <p>Open backorders</p>
        <strong className={result.backorderEnd > 0 ? "loss-text" : undefined}>
          {result.backorderEnd}
        </strong>

        {/* Net inventory: negative means customers are still owed product. */}
        <p>Ending on-hand</p>
        <strong className={result.onHandEnd < 0 ? "loss-text" : undefined}>{result.onHandEnd}</strong>

        <p>Order placed (q)</p>
        <strong>{result.orderQty}</strong>

        <p>🚢 Ship</p>
        <strong>
          {consolidatedQty > 0
            ? `${consolidatedQty} kg · ${ships} ship${ships === 1 ? "" : "s"}`
            : "—"}
        </strong>

        {(expressEnabled || expressQty > 0) && (
          <>
            <p>🚚 Truck</p>
            <strong>
              {expressQty > 0
                ? `${expressQty} kg · ${expressTrucks} truck${expressTrucks === 1 ? "" : "s"}`
                : "—"}
            </strong>
          </>
        )}

        <p>Fleet fill</p>
        <strong>
          {result.fleetFillPct !== null && result.orderQty > 0
            ? `${Math.round(result.fleetFillPct)}% full`
            : "—"}
        </strong>

        <p>Revenue</p>
        <strong>{toCurrency(result.revenue)}</strong>

        <p>Purchase cost</p>
        <strong>{toCurrency(result.purchaseCost)}</strong>

        <p>Holding cost</p>
        <strong>{toCurrency(result.holdingCost)}</strong>

        <p>Backorder penalty</p>
        <strong>{toCurrency(result.backorderCost)}</strong>

        {/* Split out once a per-unit shipping cost is in play. */}
        <p>Transport cost</p>
        <strong>
          {toCurrency(result.transportCost)}
          {result.transportVariableCost > 0 && (
            <span className="cost-split">
              {" "}
              ({toCurrency(result.transportFixedCost)} fixed + {toCurrency(result.transportVariableCost)} per unit)
            </span>
          )}
        </strong>

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
