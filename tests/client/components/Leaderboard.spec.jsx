import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import Leaderboard from "../../../src/components/Leaderboard.jsx";

describe("Leaderboard", () => {
  it("shows an empty state when there are no rows", () => {
    render(<Leaderboard rows={[]} title="Leaderboard" />);
    expect(screen.getByText(/no leaderboard data yet/i)).toBeInTheDocument();
  });

  it("renders ranked rows with currency-formatted profit", () => {
    const rows = [
      { rank: 1, nickname: "Alice", cumulativeProfit: 6420 },
      { rank: 2, nickname: "Bob", cumulativeProfit: 3190 }
    ];
    render(<Leaderboard rows={rows} title="Final Leaderboard" />);

    expect(screen.getByRole("heading", { name: "Final Leaderboard" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("$6,420")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("$3,190")).toBeInTheDocument();
  });

  it("shows a player without results (joined after the end) as dashes", () => {
    const rows = [
      { rank: 1, front: 1, nickname: "Alice", cumulativeProfit: 2473, cumCo2: 150, serviceLevelPct: 100, cumBackorders: 0, fleetFillPct: 75 },
      { rank: 2, front: 2, nickname: "LateComer", cumulativeProfit: null, cumCo2: null, serviceLevelPct: null, cumBackorders: null, fleetFillPct: null }
    ];
    render(<Leaderboard rows={rows} title="Final Leaderboard" />);

    const late = screen.getByText("LateComer").closest("tr");
    const cells = within(late).getAllByRole("cell").map((c) => c.textContent);
    // rank, front, nickname, then profit / CO2 / service / backorders / fleet fill
    expect(cells.slice(3)).toEqual(["—", "—", "—", "—", "—"]);
  });
});
