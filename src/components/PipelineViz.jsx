// Small timeline of in-transit orders: one slot per lead-time period, left-most
// arrives next round. The array carries one extra "reserve" slot beyond the
// normal lead time (held for shipping-delay events) — it's hidden while empty
// so the normal view isn't cluttered, but appears if a delay ever pushes a
// shipment out that far.
function PipelineViz({ pipeline }) {
  if (!pipeline || pipeline.length === 0) {
    return null;
  }

  const lastIndex = pipeline.length - 1;
  const visible = pipeline
    .map((qty, index) => ({ qty, index }))
    .filter(({ qty, index }) => qty > 0 || index !== lastIndex);

  return (
    <div className="pipeline-viz">
      <span className="pipeline-title">Incoming shipments</span>
      <div className="pipeline-slots">
        {visible.map(({ qty, index }) => (
          <div className={`pipeline-slot${qty > 0 ? " filled" : ""}`} key={index}>
            <span className="pipeline-qty">{qty}</span>
            <span className="pipeline-eta">
              {index === 0 ? "next round" : `in ${index + 1} rounds`}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default PipelineViz;
