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
          { label: "Holding", value: `$${config.holdingCost}/u` },
          { label: "Backorder", value: `$${config.backorderCost}/u` }
        ]}
      />
      <ChipGroup
        title="Ship"
        chips={[
          { label: "Lead time", value: `${config.leadTime} rounds` },
          { label: "Capacity", value: `${config.shipCapacity} u` },
          { label: "Cost", value: `$${config.shipCost}` },
          { label: "CO₂", value: `${config.shipCo2} kg` }
        ]}
      />
      {config.expressEnabled && (
        <ChipGroup
          title="Truck"
          chips={[
            { label: "Lead time", value: "Same round" },
            { label: "Capacity", value: `${config.expressCapacity} u` },
            { label: "Cost", value: `$${config.expressFixedCost}` },
            { label: "CO₂", value: `${config.expressCo2} kg` }
          ]}
        />
      )}
      <ChipGroup
        title="Storage & risk"
        chips={[
          { label: "CO₂/unit held", value: `${config.co2PerUnitHeld} kg` },
          ...(config.delayProbability > 0
            ? [{ label: "Delay risk", value: `${Math.round(config.delayProbability * 100)}%/round` }]
            : [])
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
