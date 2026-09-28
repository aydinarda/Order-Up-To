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

  it("plots any chosen pair of KPIs with matching labels and good direction", () => {
    const kpiRows = [
      { nickname: "Alice", cumBackorders: 10, serviceLevelPct: 95, front: 1 },
      { nickname: "Bob", cumBackorders: 5, serviceLevelPct: 80, front: 1 },
      { nickname: "Carol", cumBackorders: 80, serviceLevelPct: 60, front: 2 }
    ];
    const { container } = render(
      <ParetoScatter rows={kpiRows} selfNickname="Bob" axes={{ x: "backorders", y: "serviceLevel" }} />
    );
    expect(screen.getByRole("heading", { name: /service level vs backorders/i })).toBeInTheDocument();
    expect(screen.getByText(/Backorders \(units\)/)).toBeInTheDocument();
    expect(screen.getByText(/Service level \(%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Up-left is the good direction: higher service level, fewer backorders/)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="pareto-dot"]').length).toBe(3);
  });

  it("leaves out players without a service level yet", () => {
    const kpiRows = [
      { nickname: "Alice", cumProfit: 100, serviceLevelPct: null, front: 1 },
      { nickname: "Bob", cumProfit: 50, serviceLevelPct: null, front: 1 }
    ];
    render(<ParetoScatter rows={kpiRows} axes={{ x: "serviceLevel", y: "profit" }} />);
    expect(screen.getByText(/service level starts after the first round with demand/i)).toBeInTheDocument();
  });
});
