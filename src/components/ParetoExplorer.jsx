import { useMemo, useState } from "react";
import ParetoScatter from "./ParetoScatter";
import ParetoAxesPicker from "./ParetoAxesPicker";
import Leaderboard from "./Leaderboard";
import { computeParetoFronts, PARETO_METRICS } from "../../server/utils/pareto.js";

export function paretoCaption(axes) {
  return `Pareto fronts on ${PARETO_METRICS[axes.y].label} vs ${PARETO_METRICS[axes.x].label}.`;
}

// End-of-game report: every player (admin included) can rank the final
// standings on ANY pair of the four KPIs. It opens on the admin's pair, which
// the server already ranked; any other pair is ranked here in the browser, and
// only once someone picks it — nothing precomputes every combination. Picking a
// pair here is personal: it does not change the game setting.
function ParetoExplorer({ rows, selfNickname, defaultAxes, title }) {
  const [axes, setAxes] = useState(defaultAxes);
  const isDefault = axes.x === defaultAxes.x && axes.y === defaultAxes.y;

  const rankedRows = useMemo(
    () =>
      isDefault
        ? rows
        : computeParetoFronts(rows, axes).map((row, index) => ({ ...row, rank: index + 1 })),
    [rows, axes, isDefault]
  );

  return (
    <>
      <ParetoScatter
        rows={rankedRows}
        selfNickname={selfNickname}
        axes={axes}
        controls={
          <ParetoAxesPicker axes={axes} onChange={setAxes} idPrefix="explore" markedAxes={defaultAxes} />
        }
      />
      <Leaderboard rows={rankedRows} title={title} caption={paretoCaption(axes)} />
    </>
  );
}

export default ParetoExplorer;
