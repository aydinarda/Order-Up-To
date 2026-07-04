// Non-dominated sorting (NSGA-II style layers) over (cumProfit, cumCo2).
// Objective: maximize profit, minimize CO2.
//
// A dominates B iff A.profit >= B.profit AND A.co2 <= B.co2, with at least
// one strict. Identical points never dominate each other, so a class that all
// copied one strategy lands together on front 1.
// O(n^2) per layer is fine for classroom sizes (<= a few hundred players).

function dominates(a, b) {
  return (
    a.cumProfit >= b.cumProfit &&
    a.cumCo2 <= b.cumCo2 &&
    (a.cumProfit > b.cumProfit || a.cumCo2 < b.cumCo2)
  );
}

// Annotates each row with a 1-based `front` and returns the rows sorted by
// (front asc, cumProfit desc). Rows must carry numeric cumProfit and cumCo2.
export function computeParetoFronts(rows) {
  const remaining = rows.map((row) => ({ ...row }));
  const sorted = [];
  let front = 1;

  while (remaining.length > 0) {
    const dominated = remaining.map((row) =>
      remaining.some((other) => other !== row && dominates(other, row))
    );
    const currentFront = remaining.filter((_, i) => !dominated[i]);
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (!dominated[i]) remaining.splice(i, 1);
    }
    currentFront.forEach((row) => {
      row.front = front;
    });
    currentFront.sort((a, b) => b.cumProfit - a.cumProfit);
    sorted.push(...currentFront);
    front += 1;
  }

  return sorted;
}
