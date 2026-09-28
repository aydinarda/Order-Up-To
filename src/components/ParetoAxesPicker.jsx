import { PARETO_METRICS } from "../../server/utils/pareto.js";

// Y / X dropdowns over the four KPIs, shown on top of the Pareto chart. A KPI
// picked on one axis is disabled on the other, so the pair is always valid.
// `markedAxes` (optional) tags the game's own pair as "(game setting)".
function ParetoAxesPicker({ axes, onChange, idPrefix, markedAxes = null, disabled = false, note = null }) {
  const axisSelect = (axis, label) => {
    const other = axis === "x" ? axes.y : axes.x;
    return (
      <label htmlFor={`${idPrefix}-${axis}`}>
        {label}
        <select
          id={`${idPrefix}-${axis}`}
          value={axes[axis]}
          onChange={(event) => onChange({ ...axes, [axis]: event.target.value })}
          disabled={disabled}
        >
          {Object.entries(PARETO_METRICS).map(([id, metric]) => (
            <option key={id} value={id} disabled={id === other}>
              {metric.label}
              {markedAxes && id === markedAxes[axis] ? " (game setting)" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  };

  return (
    <div className="pareto-axes">
      {axisSelect("y", "Y axis")}
      {axisSelect("x", "X axis")}
      {note ? <p className="muted-text pareto-axes-note">{note}</p> : null}
    </div>
  );
}

export default ParetoAxesPicker;
