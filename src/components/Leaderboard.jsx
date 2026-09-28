// null = no result (e.g. joined after the game ended).
function formatMoney(value) {
  if (value == null) {
    return "—";
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatCo2(value) {
  return `${Math.round(value)} kg`;
}

// Ranked by Pareto front first (front 1 = undominated on the chosen pair of
// KPIs, CO2 vs profit by default), then within a front by the pair's
// higher-priority KPI (profit > service level > backorders > CO2).
// `caption` names the pair the fronts were computed on.
function Leaderboard({ rows, title, caption }) {
  const hasFronts = rows.some((row) => row.front !== undefined);

  return (
    <section className="card">
      <h3>{title}</h3>
      {caption && hasFronts && rows.length > 0 ? (
        <p className="muted-text leaderboard-caption">{caption}</p>
      ) : null}
      {rows.length === 0 ? (
        <p className="muted">No leaderboard data yet.</p>
      ) : (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              {hasFronts && <th>Front</th>}
              <th>Nickname</th>
              <th>Profit</th>
              {hasFronts && <th>CO₂</th>}
              {hasFronts && <th>Service level</th>}
              {hasFronts && <th>Backorders</th>}
              {hasFronts && <th>Fleet fill</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.nickname}-${row.rank}`} className={row.rank === 1 ? "top-rank" : undefined}>
                <td>{row.rank}</td>
                {hasFronts && <td>{row.front}</td>}
                <td>{row.nickname}</td>
                <td>{formatMoney(row.cumulativeProfit)}</td>
                {hasFronts && <td>{row.cumCo2 != null ? formatCo2(row.cumCo2) : "—"}</td>}
                {hasFronts && (
                  <td>{row.serviceLevelPct != null ? `${Math.round(row.serviceLevelPct)}%` : "—"}</td>
                )}
                {hasFronts && <td>{row.cumBackorders ?? "—"}</td>}
                {hasFronts && (
                  <td>{row.fleetFillPct != null ? `${Math.round(row.fleetFillPct)}%` : "—"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export default Leaderboard;
