import { DEFAULT_PARETO_AXES, PARETO_METRICS } from "../../server/utils/pareto.js";

// Pareto scatter — the debrief centerpiece. One dot per player over the two
// KPIs in `axes` (default x = cumulative CO2, y = cumulative profit); rows must
// already carry their `front` for that pair. Dot color is an ordinal
// single-hue ramp over the player's Pareto front (validated against the app
// surface); the front-1 frontier is connected by a step line. The player's own
// dot gets an accent ring. Identity is never color-alone: dots are
// direct-labeled (collision-free; players on the very same spot share one
// label) and the leaderboard table sits next to the chart.

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

// Approximate label box at font-size 11 (slightly generous per character so
// boxes never underestimate the rendered text).
const CHAR_WIDTH = 6.4;
const LABEL_HEIGHT = 13;

// Where a label may sit relative to its dot, in order of preference.
const LABEL_SLOTS = [
  { dx: 11, dy: -8, anchor: "start" }, // right, above
  { dx: 15, dy: 4, anchor: "start" }, // right, level with the dot
  { dx: 11, dy: 16, anchor: "start" }, // right, below
  { dx: -11, dy: -8, anchor: "end" }, // left, above
  { dx: -15, dy: 4, anchor: "end" }, // left, level with the dot
  { dx: -11, dy: 16, anchor: "end" }, // left, below
  { dx: 0, dy: -14, anchor: "middle" }, // above
  { dx: 0, dy: 26, anchor: "middle" } // below
];

// Greedy, collision-free label placement. `labels` ({ text, cx, cy }) arrive
// in priority order — the viewing player first — and each takes the first slot
// that stays inside `bounds` and clears every label placed before it. Slots
// that also keep clear of other dots (`dots`: [{ cx, cy }]) are preferred, so a
// name is not read as belonging to a neighbour; one covering a dot is used only
// when nothing else fits. A label with no free slot is dropped: the name is
// still in the dot's tooltip and the leaderboard table.
// Keep-out radius around a dot (r 7 + its white stroke), and around the
// viewing player's gold ring (r 11).
const DOT_RADIUS = 9;
const SELF_RING_RADIUS = 13;

export function placeLabels(labels, bounds, dots = []) {
  const boxes = [];
  const placed = [];
  const overlaps = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  const dotBoxes = dots.map((d) => {
    const r = d.isSelf ? SELF_RING_RADIUS : DOT_RADIUS;
    return { cx: d.cx, cy: d.cy, left: d.cx - r, right: d.cx + r, top: d.cy - r, bottom: d.cy + r };
  });

  for (const label of labels) {
    const w = label.text.length * CHAR_WIDTH;
    const candidates = LABEL_SLOTS.map((slot) => {
      const x = label.cx + slot.dx;
      const y = label.cy + slot.dy;
      const left = slot.anchor === "start" ? x : slot.anchor === "end" ? x - w : x - w / 2;
      return { slot, x, y, box: { left, right: left + w, top: y - LABEL_HEIGHT + 3, bottom: y + 3 } };
    }).filter(
      ({ box }) =>
        box.left >= bounds.left &&
        box.right <= bounds.right &&
        box.top >= bounds.top &&
        box.bottom <= bounds.bottom &&
        boxes.every((b) => !overlaps(box, b))
    );
    const coversDot = ({ box }) =>
      dotBoxes.some((d) => !(d.cx === label.cx && d.cy === label.cy) && overlaps(box, d));
    const choice = candidates.find((c) => !coversDot(c)) || candidates[0];
    if (choice) {
      boxes.push(choice.box);
      placed.push({ ...label, x: choice.x, y: choice.y, anchor: choice.slot.anchor });
    }
  }
  return placed;
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

  // Dots in rank order; players landing on the same pixel (identical KPIs,
  // e.g. bots on one strategy, or all but identical) get one label: "Green03 +9".
  const points = playable.map((row) => ({
    row,
    cx: x(xOf(row)),
    cy: y(yOf(row)),
    isSelf: Boolean(selfNickname) && row.nickname === selfNickname
  }));
  const spots = new Map();
  for (const point of points) {
    const key = `${Math.round(point.cx)},${Math.round(point.cy)}`;
    if (!spots.has(key)) spots.set(key, []);
    spots.get(key).push(point);
  }
  const spotOf = (point) => spots.get(`${Math.round(point.cx)},${Math.round(point.cy)}`);

  // Label everyone in a small class; otherwise front 1 and the viewing player.
  const labelAll = playable.length <= 10;
  const labelCandidates = [...spots.values()]
    .filter((group) => group.some((p) => labelAll || p.row.front === 1 || p.isSelf))
    .map((group) => {
      const lead = group.find((p) => p.isSelf) || group[0];
      const text =
        `${lead.row.nickname}${lead.isSelf ? " (you)" : ""}` + (group.length > 1 ? ` +${group.length - 1}` : "");
      return { text, cx: lead.cx, cy: lead.cy, isSelf: group.some((p) => p.isSelf) };
    })
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
  const labels = placeLabels(
    labelCandidates,
    { left: margin.left, right: width, top: 0, bottom: margin.top + plotH },
    points
  );

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
        {points.map((point) => {
          const { row, cx, cy, isSelf } = point;
          const others = spotOf(point).filter((p) => p !== point).map((p) => p.row.nickname);
          const alsoHere = others.length
            ? `\nAlso here: ${others.slice(0, 8).join(", ")}${others.length > 8 ? ", …" : ""}`
            : "";
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
                  {`${row.nickname} — front ${row.front}, ${yMetric.label} ${formatValue(yMetric, yOf(row))}, ${xMetric.label} ${formatValue(xMetric, xOf(row))}${alsoHere}`}
                </title>
              </circle>
            </g>
          );
        })}

        {/* labels on top of every dot, with a surface-colored halo so they stay
            readable over grid lines and neighbouring dots */}
        {labels.map((label) => (
          <text
            key={label.text}
            x={label.x}
            y={label.y}
            textAnchor={label.anchor}
            fontSize="11"
            fontWeight={label.isSelf ? "700" : "400"}
            fill={LABEL}
            stroke={SURFACE}
            strokeWidth="3"
            paintOrder="stroke"
            data-testid="pareto-label"
          >
            {label.text}
          </text>
        ))}
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
