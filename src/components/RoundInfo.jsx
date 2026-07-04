import { describeDistribution } from "../utils/demand";

function PricesDetail({ prices }) {
  if (!prices) return null;

  const chips = [
    { label: "Retail", value: prices.retailPrice },
    { label: "Wholesale", value: prices.wholesaleCost },
    { label: "Salvage", value: prices.salvagePrice }
  ];

  return (
    <div className="prices-detail">
      {chips.map((chip) => (
        <div className="price-chip" key={chip.label}>
          <span className="price-label">{chip.label}</span>
          <span className="price-value">${chip.value}</span>
        </div>
      ))}
    </div>
  );
}

function DistributionDetail({ distribution }) {
  return (
    <div className="dist-badge">
      <span className="dist-badge-label">Demand</span>
      <span className="dist-badge-value">{describeDistribution(distribution)}</span>
    </div>
  );
}

function RoundInfo({ round, totalRounds, prices }) {
  return (
    <section className="card round-info">
      <p className="eyebrow">Round {round.id} / {totalRounds}</p>
      <h2>{round.title}</h2>
      <PricesDetail prices={prices} />
      <DistributionDetail distribution={round.distribution} />
    </section>
  );
}

export default RoundInfo;
