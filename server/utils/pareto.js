// Non-dominated sorting (NSGA-II style layers) over TWO of the leaderboard
// KPIs. The admin picks the pair (config.paretoX / config.paretoY, default
// CO2 vs profit); only that pair is ranked each round. The end-of-game report
// lets every player explore any other pair — ranked on demand in the browser,
// which imports this same module so both sides agree on the rules.
//
// A dominates B iff A is at least as good as B on both KPIs, and strictly
// better on at least one. Identical points never dominate each other, so a
// class that all copied one strategy lands together on front 1.
// O(n^2) per layer is fine for classroom sizes (<= a few hundred players).
//
// Within a front, players are ordered by the pair's higher-`priority` KPI
// (profit > service level > backorders > CO2), then by the other — never by
// which KPI happens to sit on which chart axis, so swapping the axes of a pair
// leaves the ranking unchanged.

// The KPIs a Pareto chart can use. `key` is the leaderboard row field; `goal`
// says which way is better; `priority` breaks ties within a front (1 first);
// `min`/`max` bound the chart axis.
export const PARETO_METRICS = {
  profit: {
    key: "cumProfit",
    label: "Cumulative profit",
    unit: "$",
    goal: "max",
    priority: 1,
    better: "more profit"
  },
  serviceLevel: {
    key: "serviceLevelPct",
    label: "Service level",
    unit: "%",
    goal: "max",
    priority: 2,
    better: "higher service level",
    min: 0,
    max: 100
  },
  backorders: {
    key: "cumBackorders",
    label: "Backorders",
    unit: "units",
    goal: "min",
    priority: 3,
    better: "fewer backorders",
    min: 0
  },
  co2: {
    key: "cumCo2",
    label: "Cumulative CO₂",
    unit: "kg",
    goal: "min",
    priority: 4,
    better: "less CO₂",
    min: 0
  }
};

export const DEFAULT_PARETO_AXES = { x: "co2", y: "profit" };

export function isValidParetoAxes({ x, y } = {}) {
  return x in PARETO_METRICS && y in PARETO_METRICS && x !== y;
}

// Game config stores the pair as paretoX / paretoY.
export function paretoAxesFromConfig(config) {
  const axes = { x: config?.paretoX, y: config?.paretoY };
  return isValidParetoAxes(axes) ? axes : DEFAULT_PARETO_AXES;
}

// Oriented so that bigger is always better. A missing value (service level
// before any demand) counts as the worst possible.
function score(row, metricId) {
  const metric = PARETO_METRICS[metricId];
  const value = row[metric.key];
  if (!Number.isFinite(value)) {
    return -Infinity;
  }
  return metric.goal === "max" ? value : -value;
}

// Annotates each row with a 1-based `front` for the given pair and returns the
// rows sorted by (front asc, then the higher-priority KPI, then the other).
// Input rows are not mutated.
export function computeParetoFronts(rows, axes = DEFAULT_PARETO_AXES) {
  const remaining = rows.map((row) => ({
    row: { ...row },
    x: score(row, axes.x),
    y: score(row, axes.y)
  }));
  const dominates = (a, b) => a.x >= b.x && a.y >= b.y && (a.x > b.x || a.y > b.y);
  // Tie-break within a front by KPI priority, independent of axis orientation.
  const xFirst = PARETO_METRICS[axes.x].priority < PARETO_METRICS[axes.y].priority;
  const withinFront = xFirst ? (a, b) => b.x - a.x || b.y - a.y : (a, b) => b.y - a.y || b.x - a.x;
  const sorted = [];
  let front = 1;

  while (remaining.length > 0) {
    const dominated = remaining.map((entry) =>
      remaining.some((other) => other !== entry && dominates(other, entry))
    );
    const currentFront = remaining.filter((_, i) => !dominated[i]);
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (!dominated[i]) remaining.splice(i, 1);
    }
    currentFront.sort(withinFront);
    for (const entry of currentFront) {
      entry.row.front = front;
      sorted.push(entry.row);
    }
    front += 1;
  }

  return sorted;
}
