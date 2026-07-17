function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatCo2(value) {
  return `${Math.round(value)} kg`;
}

// Ranked by Pareto front first (front 1 = undominated on profit + CO2),
// then by profit within a front.
function Leaderboard({ rows, title }) {
  const hasFronts = rows.some((row) => row.front !== undefined);

  return (
    <section className="card">
      <h3>{title}</h3>
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
              {hasFronts && <th>Lost sales</th>}
              {hasFronts && <th>Truck fill</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.nickname}-${row.rank}`} className={row.rank === 1 ? "top-rank" : undefined}>
                <td>{row.rank}</td>
                {hasFronts && <td>{row.front}</td>}
                <td>{row.nickname}</td>
                <td>{formatMoney(row.cumulativeProfit)}</td>
                {hasFronts && <td>{row.cumCo2 !== undefined ? formatCo2(row.cumCo2) : "—"}</td>}
                {hasFronts && (
                  <td>{row.serviceLevelPct != null ? `${Math.round(row.serviceLevelPct)}%` : "—"}</td>
                )}
                {hasFronts && <td>{row.cumLost ?? "—"}</td>}
                {hasFronts && (
                  <td>{row.truckFillPct != null ? `${Math.round(row.truckFillPct)}%` : "—"}</td>
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
