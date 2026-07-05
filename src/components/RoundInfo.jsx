import { describeDistribution } from "../utils/demand";

function ChipGroup({ title, chips }) {
  return (
    <div className="chip-group">
      <span className="chip-group-title">{title}</span>
      <div className="prices-detail">
        {chips.map((chip) => (
          <div className="price-chip" key={chip.label}>
            <span className="price-label">{chip.label}</span>
            <span className="price-value">{chip.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigDetail({ config }) {
  if (!config) return null;

  return (
    <div className="config-detail">
      <ChipGroup
        title="Economics"
        chips={[
          { label: "Price", value: `$${config.price}` },
          { label: "Unit cost", value: `$${config.unitCost}` },
          { label: "Holding", value: `$${config.holdingCost}/u` }
        ]}
      />
      <ChipGroup
        title="Logistics"
        chips={[
          { label: "Lead time", value: `${config.leadTime} rounds` },
          { label: "Truck cap.", value: `${config.truckCapacity} u` },
          { label: "Truck cost", value: `$${config.fixedCostPerTruck}` }
        ]}
      />
      <ChipGroup
        title="CO₂"
        chips={[
          { label: "Per truck", value: `${config.co2PerTruck} kg` },
          { label: "Per unit held", value: `${config.co2PerUnitHeld} kg` }
        ]}
      />
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

function RoundInfo({ round, totalRounds, config }) {
  return (
    <section className="card round-info">
      <p className="eyebrow">Round {round.id} / {totalRounds}</p>
      <h2>{round.title}</h2>
      <ConfigDetail config={config} />
      <DistributionDetail distribution={round.distribution} />
    </section>
  );
}

export default RoundInfo;
