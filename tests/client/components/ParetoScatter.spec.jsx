import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ParetoScatter from "../../../src/components/ParetoScatter.jsx";

const rows = [
  { nickname: "Alice", cumProfit: 3800, cumCo2: 100, front: 1 },
  { nickname: "Bob", cumProfit: 2750, cumCo2: 200, front: 2 },
  { nickname: "Carol", cumProfit: 1150, cumCo2: 400, front: 3 }
];

describe("ParetoScatter", () => {
  it("renders one dot per player", () => {
    const { container } = render(<ParetoScatter rows={rows} selfNickname="Bob" />);
    expect(container.querySelectorAll('[data-testid="pareto-dot"]').length).toBe(3);
  });

  it("highlights the viewing player's dot", () => {
    render(<ParetoScatter rows={rows} selfNickname="Bob" />);
    expect(screen.getByText(/Bob \(you\)/)).toBeInTheDocument();
  });

  it("shows a placeholder message with fewer than two players", () => {
    render(<ParetoScatter rows={[rows[0]]} selfNickname="Alice" />);
    expect(screen.getByText(/at least two players/i)).toBeInTheDocument();
  });

  it("survives empty rows without crashing", () => {
    render(<ParetoScatter rows={[]} selfNickname="Alice" />);
    expect(screen.getByText(/at least two players/i)).toBeInTheDocument();
  });
});
