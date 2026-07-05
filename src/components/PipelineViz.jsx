// Small timeline of in-transit orders: one slot per lead-time period,
// left-most arrives next round.
function PipelineViz({ pipeline }) {
  if (!pipeline || pipeline.length === 0) {
    return null;
  }

  return (
    <div className="pipeline-viz">
      <span className="pipeline-title">Incoming shipments</span>
      <div className="pipeline-slots">
        {pipeline.map((qty, index) => (
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
