import { DEFAULT_PARETO_AXES, PARETO_METRICS } from "../../server/utils/pareto.js";

// Pareto scatter — the debrief centerpiece. One dot per player over the two
// KPIs in `axes` (default x = cumulative CO2, y = cumulative profit); rows must
// already carry their `front` for that pair. Dot color is an ordinal
// single-hue ramp over the player's Pareto front (validated against the app
// surface); the front-1 frontier is connected by a step line. The player's own
// dot gets an accent ring. Identity is never color-alone: dots are
// direct-labeled and the leaderboard table sits next to the chart.

// Ordinal single-hue orchard-green ramp over Pareto fronts; the self-dot ring is
// gold, matching the Orchard & Hazelnut palette.
const FRONT_RAMP = ["#2f6b3f", "#5c9e6a", "#9cc6a3"];
const SURFACE = "#fbf8f0";
const ACCENT = "#c8912f";
const GRID = "#e2d9c6";
const AXIS = "#7c7161";
const LABEL = "#2c2620";

function frontColor(front) {
  return FRONT_RAMP[Math.min(front - 1, FRONT_RAMP.length - 1)];
}

// ~4 round-numbered ticks spanning [min, max].
function makeTicks(min, max) {
  if (min === max) {
    return [min];
  }
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const err = span / 4 / step;
  const factor = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const size = factor * step;
  const start = Math.ceil(min / size) * size;
  const ticks = [];
  for (let v = start; v <= max + size * 1e-9; v += size) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

function formatTick(value) {
  if (Math.abs(value) >= 1000) {
    return `${Math.round(value / 100) / 10}k`;
  }
  return String(Math.round(value * 10) / 10);
}

function formatValue(metric, value) {
  const rounded = Math.round(value);
  if (metric.unit === "$") return `$${rounded.toLocaleString("en-US")}`;
  if (metric.unit === "%") return `${rounded}%`;
  return `${rounded.toLocaleString("en-US")} ${metric.unit}`;
}

// "Up-left" etc.: where the better players sit on this pair.
function goodDirection(xMetric, yMetric) {
  const vertical = yMetric.goal === "max" ? "Up" : "Down";
  const horizontal = xMetric.goal === "max" ? "right" : "left";
  return `${vertical}-${horizontal}`;
}

function ParetoScatter({ rows, selfNickname, axes = DEFAULT_PARETO_AXES, controls = null }) {
  const xMetric = PARETO_METRICS[axes.x];
  const yMetric = PARETO_METRICS[axes.y];
  const title = `${yMetric.label} vs ${xMetric.label}`;
  const xOf = (row) => row[xMetric.key];
  const yOf = (row) => row[yMetric.key];

  // Service level stays empty until a round with demand has been played.
  const playable = (rows || []).filter(
    (row) => Number.isFinite(xOf(row)) && Number.isFinite(yOf(row))
  );

  if (playable.length < 2) {
    return (
      <section className="card pareto-card">
        <h3>{title}</h3>
        {controls}
        <p className="muted-text">
          The Pareto chart appears once at least two players have results
          {axes.x === "serviceLevel" || axes.y === "serviceLevel"
            ? " (service level starts after the first round with demand)"
            : ""}
          .
        </p>
      </section>
    );
  }

  const width = 640;
  const height = 400;
  const margin = { top: 24, right: 32, bottom: 52, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  // Padded data range, kept inside the KPI's natural bounds (e.g. 0–100%).
  const axisRange = (values, metric) => {
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = hi === lo ? Math.abs(hi) * 0.1 + 1 : (hi - lo) * 0.1;
    return [Math.max(metric.min ?? -Infinity, lo - pad), Math.min(metric.max ?? Infinity, hi + pad)];
  };
  const [xMin, xMax] = axisRange(playable.map(xOf), xMetric);
  const [yMin, yMax] = axisRange(playable.map(yOf), yMetric);

  const x = (v) => margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const y = (v) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const xTicks = makeTicks(xMin, xMax);
  const yTicks = makeTicks(yMin, yMax);

  // Frontier step line through front-1 dots, sorted left to right. It steps
  // through the corner both neighbours dominate: when lower X is better the
  // next dot is worse on X, so go across first; when higher X is better, go
  // up/down first.
  const frontier = playable.filter((row) => row.front === 1).sort((a, b) => xOf(a) - xOf(b));
  const acrossFirst = xMetric.goal === "min";
  let frontierPath = "";
  frontier.forEach((row, i) => {
    const px = x(xOf(row));
    const py = y(yOf(row));
    if (i === 0) {
      frontierPath = `M ${px} ${py}`;
    } else {
      frontierPath += acrossFirst ? ` H ${px} V ${py}` : ` V ${py} H ${px}`;
    }
  });

  const labelAll = playable.length <= 10;
  const maxFront = Math.max(...playable.map((r) => r.front || 1));
  const legendFronts = Array.from({ length: Math.min(maxFront, 3) }, (_, i) => i + 1);

  return (
    <section className="card pareto-card">
      <h3>{title} — Pareto fronts</h3>
      {controls}
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Scatter chart of ${yMetric.label.toLowerCase()} versus ${xMetric.label.toLowerCase()} per player, colored by Pareto front`}
        style={{ width: "100%", height: "auto" }}
      >
        {/* grid */}
        {xTicks.map((t) => (
          <line
            key={`gx-${t}`}
            x1={x(t)}
            x2={x(t)}
            y1={margin.top}
            y2={margin.top + plotH}
            stroke={GRID}
            strokeWidth="1"
          />
        ))}
        {yTicks.map((t) => (
          <line
            key={`gy-${t}`}
            x1={margin.left}
            x2={margin.left + plotW}
            y1={y(t)}
            y2={y(t)}
            stroke={GRID}
            strokeWidth="1"
          />
        ))}

        {/* axes */}
        <line
          x1={margin.left}
          x2={margin.left + plotW}
          y1={margin.top + plotH}
          y2={margin.top + plotH}
          stroke={AXIS}
          strokeWidth="1"
        />
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + plotH}
          stroke={AXIS}
          strokeWidth="1"
        />
        {xTicks.map((t) => (
          <text
            key={`xt-${t}`}
            x={x(t)}
            y={margin.top + plotH + 18}
            textAnchor="middle"
            fontSize="11"
            fill={AXIS}
          >
            {formatTick(t)}
          </text>
        ))}
        {yTicks.map((t) => (
          <text
            key={`yt-${t}`}
            x={margin.left - 8}
            y={y(t) + 4}
            textAnchor="end"
            fontSize="11"
            fill={AXIS}
          >
            {formatTick(t)}
          </text>
        ))}
        <text
          x={margin.left + plotW / 2}
          y={height - 12}
          textAnchor="middle"
          fontSize="12"
          fill={LABEL}
        >
          {xMetric.label} ({xMetric.unit}) →
        </text>
        <text
          x={16}
          y={margin.top + plotH / 2}
          textAnchor="middle"
          fontSize="12"
          fill={LABEL}
          transform={`rotate(-90 16 ${margin.top + plotH / 2})`}
        >
          {yMetric.label} ({yMetric.unit}) →
        </text>

        {/* front-1 frontier step line */}
        {frontier.length > 1 && (
          <path d={frontierPath} fill="none" stroke={FRONT_RAMP[0]} strokeWidth="2" strokeDasharray="4 3" />
        )}

        {/* dots */}
        {playable.map((row) => {
          const isSelf = selfNickname && row.nickname === selfNickname;
          const cx = x(xOf(row));
          const cy = y(yOf(row));
          // Dots in the right quarter label to their left so names never run
          // off the chart edge.
          const labelLeft = cx > margin.left + plotW * 0.75;
          return (
            <g key={row.nickname} data-testid="pareto-dot">
              {isSelf && (
                <circle cx={cx} cy={cy} r={11} fill="none" stroke={ACCENT} strokeWidth="2.5" />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={7}
                fill={frontColor(row.front || 1)}
                stroke={SURFACE}
                strokeWidth="2"
              >
                <title>
                  {`${row.nickname} — front ${row.front}, ${yMetric.label} ${formatValue(yMetric, yOf(row))}, ${xMetric.label} ${formatValue(xMetric, xOf(row))}`}
                </title>
              </circle>
              {(labelAll || row.front === 1 || isSelf) && (
                <text
                  x={labelLeft ? cx - 11 : cx + 11}
                  y={cy - 8}
                  textAnchor={labelLeft ? "end" : "start"}
                  fontSize="11"
                  fontWeight={isSelf ? "700" : "400"}
                  fill={LABEL}
                >
                  {row.nickname}
                  {isSelf ? " (you)" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="pareto-legend">
        {legendFronts.map((front) => (
          <span key={front} className="pareto-legend-item">
            <span className="pareto-legend-dot" style={{ background: frontColor(front) }} />
            {front === 3 && maxFront > 3 ? "Front 3+" : `Front ${front}`}
            {front === 1 ? " (efficient)" : ""}
          </span>
        ))}
      </div>
      <p className="muted-text pareto-hint">
        {goodDirection(xMetric, yMetric)} is the good direction: {yMetric.better},{" "}
        {xMetric.better}. Front 1 players are not beaten on both counts by anyone.
      </p>
    </section>
  );
}

export default ParetoScatter;
