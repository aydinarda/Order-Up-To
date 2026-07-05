// Profit-vs-CO2 Pareto scatter — the debrief centerpiece. One dot per player;
// x = cumulative CO2 (minimize), y = cumulative profit (maximize). Dot color is
// an ordinal single-hue ramp over the player's Pareto front (validated against
// the app surface); the front-1 frontier is connected by a step line. The
// player's own dot gets an accent ring. Identity is never color-alone: dots are
// direct-labeled and the leaderboard table sits next to the chart.

const FRONT_RAMP = ["#2a78d6", "#5598e7", "#86b6ef"];
const SURFACE = "#fffcf8";
const ACCENT = "#ff5f2e";

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

function ParetoScatter({ rows, selfNickname }) {
  const playable = (rows || []).filter(
    (row) => Number.isFinite(row.cumCo2) && Number.isFinite(row.cumProfit)
  );

  if (playable.length < 2) {
    return (
      <section className="card pareto-card">
        <h3>Profit vs CO₂</h3>
        <p className="muted-text">
          The Pareto chart appears once at least two players have results.
        </p>
      </section>
    );
  }

  const width = 640;
  const height = 400;
  const margin = { top: 24, right: 32, bottom: 52, left: 72 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;

  const co2Values = playable.map((r) => r.cumCo2);
  const profitValues = playable.map((r) => r.cumProfit);
  const pad = (max, min) => (max === min ? Math.abs(max) * 0.1 + 1 : (max - min) * 0.1);

  const xPad = pad(Math.max(...co2Values), Math.min(...co2Values));
  const yPad = pad(Math.max(...profitValues), Math.min(...profitValues));
  const xMin = Math.max(0, Math.min(...co2Values) - xPad);
  const xMax = Math.max(...co2Values) + xPad;
  const yMin = Math.min(...profitValues) - yPad;
  const yMax = Math.max(...profitValues) + yPad;

  const x = (v) => margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
  const y = (v) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  const xTicks = makeTicks(xMin, xMax);
  const yTicks = makeTicks(yMin, yMax);

  // Frontier step line through front-1 dots: sorted by CO2, stepping so the
  // line only moves right (more CO2) and up (more profit).
  const frontier = playable
    .filter((row) => row.front === 1)
    .sort((a, b) => a.cumCo2 - b.cumCo2);
  let frontierPath = "";
  frontier.forEach((row, i) => {
    const px = x(row.cumCo2);
    const py = y(row.cumProfit);
    if (i === 0) {
      frontierPath = `M ${px} ${py}`;
    } else {
      frontierPath += ` H ${px} V ${py}`;
    }
  });

  const labelAll = playable.length <= 10;
  const maxFront = Math.max(...playable.map((r) => r.front || 1));
  const legendFronts = Array.from({ length: Math.min(maxFront, 3) }, (_, i) => i + 1);

  return (
    <section className="card pareto-card">
      <h3>Profit vs CO₂ — Pareto fronts</h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Scatter chart of cumulative profit versus cumulative CO2 per player, colored by Pareto front"
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
            stroke="#e5dbcd"
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
            stroke="#e5dbcd"
            strokeWidth="1"
          />
        ))}

        {/* axes */}
        <line
          x1={margin.left}
          x2={margin.left + plotW}
          y1={margin.top + plotH}
          y2={margin.top + plotH}
          stroke="#7a7167"
          strokeWidth="1"
        />
        <line
          x1={margin.left}
          x2={margin.left}
          y1={margin.top}
          y2={margin.top + plotH}
          stroke="#7a7167"
          strokeWidth="1"
        />
        {xTicks.map((t) => (
          <text
            key={`xt-${t}`}
            x={x(t)}
            y={margin.top + plotH + 18}
            textAnchor="middle"
            fontSize="11"
            fill="#7a7167"
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
            fill="#7a7167"
          >
            {formatTick(t)}
          </text>
        ))}
        <text
          x={margin.left + plotW / 2}
          y={height - 12}
          textAnchor="middle"
          fontSize="12"
          fill="#38332d"
        >
          Cumulative CO₂ (kg) →
        </text>
        <text
          x={16}
          y={margin.top + plotH / 2}
          textAnchor="middle"
          fontSize="12"
          fill="#38332d"
          transform={`rotate(-90 16 ${margin.top + plotH / 2})`}
        >
          Cumulative profit ($) →
        </text>

        {/* front-1 frontier step line */}
        {frontier.length > 1 && (
          <path d={frontierPath} fill="none" stroke={FRONT_RAMP[0]} strokeWidth="2" strokeDasharray="4 3" />
        )}

        {/* dots */}
        {playable.map((row) => {
          const isSelf = selfNickname && row.nickname === selfNickname;
          const cx = x(row.cumCo2);
          const cy = y(row.cumProfit);
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
                  {`${row.nickname} — front ${row.front}, profit $${Math.round(row.cumProfit)}, CO₂ ${Math.round(row.cumCo2)} kg`}
                </title>
              </circle>
              {(labelAll || row.front === 1 || isSelf) && (
                <text
                  x={cx + 11}
                  y={cy - 8}
                  fontSize="11"
                  fontWeight={isSelf ? "700" : "400"}
                  fill="#38332d"
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
        Up-left is the good direction: more profit, less CO₂. Front 1 players are not beaten
        on both counts by anyone.
      </p>
    </section>
  );
}

export default ParetoScatter;
