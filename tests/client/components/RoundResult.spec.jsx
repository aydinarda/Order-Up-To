import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoundResult from "../../../src/components/RoundResult.jsx";

describe("RoundResult", () => {
  it("renders nothing without a result", () => {
    const { container } = render(<RoundResult result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the result breakdown and the round profit", () => {
    const result = {
      orderQuantity: 120,
      realizedDemand: 95,
      soldUnits: 95,
      unsoldUnits: 25,
      revenue: 3800,
      salvageValue: 125,
      totalCost: 1200,
      profit: 2725
    };
    render(<RoundResult result={result} />);

    expect(screen.getByText("Round Result")).toBeInTheDocument();
    expect(screen.getByText("Order quantity")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText(/Round profit:/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,725/)).toBeInTheDocument();
  });
});
