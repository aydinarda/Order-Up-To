import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
});
