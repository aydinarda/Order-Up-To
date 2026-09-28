import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ParetoExplorer from "../../../src/components/ParetoExplorer.jsx";

// Server-ranked on the game's pair (CO2 vs profit): a genuine trade-off, so
// both players share front 1.
const rows = [
  { rank: 1, front: 1, nickname: "Rich", cumulativeProfit: 900, cumProfit: 900, cumCo2: 400, cumBackorders: 0, serviceLevelPct: 100 },
  { rank: 2, front: 1, nickname: "Green", cumulativeProfit: 100, cumProfit: 100, cumCo2: 10, cumBackorders: 50, serviceLevelPct: 70 }
];

function frontsInTable() {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const cells = within(row).getAllByRole("cell");
      return [cells[2].textContent, cells[1].textContent];
    });
}

describe("ParetoExplorer", () => {
  it("opens on the game's pair and shows the server ranking", () => {
    render(<ParetoExplorer rows={rows} selfNickname="Green" defaultAxes={{ x: "co2", y: "profit" }} title="Final Leaderboard" />);

    expect(screen.getByLabelText("X axis")).toHaveValue("co2");
    expect(screen.getByLabelText("Y axis")).toHaveValue("profit");
    expect(screen.getByText(/pareto fronts on cumulative profit vs cumulative co₂/i)).toBeInTheDocument();
    expect(frontsInTable()).toEqual([
      ["Rich", "1"],
      ["Green", "1"]
    ]);
  });

  it("re-ranks chart and table when a player picks another pair", async () => {
    render(<ParetoExplorer rows={rows} selfNickname="Green" defaultAxes={{ x: "co2", y: "profit" }} title="Final Leaderboard" />);

    await userEvent.selectOptions(screen.getByLabelText("X axis"), "backorders");

    expect(screen.getByRole("heading", { name: /cumulative profit vs backorders/i })).toBeInTheDocument();
    // Rich has more profit AND fewer backorders, so Green falls to front 2.
    expect(frontsInTable()).toEqual([
      ["Rich", "1"],
      ["Green", "2"]
    ]);
  });

  it("never offers the same KPI on both axes", () => {
    render(<ParetoExplorer rows={rows} defaultAxes={{ x: "co2", y: "profit" }} title="Final Leaderboard" />);

    const xOptions = within(screen.getByLabelText("X axis")).getAllByRole("option");
    expect(xOptions.find((o) => o.value === "profit")).toBeDisabled();
    const yOptions = within(screen.getByLabelText("Y axis")).getAllByRole("option");
    expect(yOptions.find((o) => o.value === "co2")).toBeDisabled();
  });

  it("marks the game's pair and keeps the explored pair personal", async () => {
    render(<ParetoExplorer rows={rows} defaultAxes={{ x: "co2", y: "profit" }} title="Final Leaderboard" />);

    const xSelect = screen.getByLabelText("X axis");
    expect(within(xSelect).getByRole("option", { name: /cumulative co₂ \(game setting\)/i })).toBeInTheDocument();
    await userEvent.selectOptions(xSelect, "serviceLevel");
    expect(xSelect).toHaveValue("serviceLevel");
  });
});
