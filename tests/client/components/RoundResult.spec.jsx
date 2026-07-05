import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoundResult from "../../../src/components/RoundResult.jsx";

describe("RoundResult", () => {
  it("renders nothing without a result", () => {
    const { container } = render(<RoundResult result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the order-up-to breakdown, lost sales, CO2 and profit", () => {
    const result = {
      arrival: 40,
      realizedDemand: 95,
      sold: 95,
      lost: 5,
      onHandEnd: 20,
      orderQty: 150,
      trucks: 2,
      truckFillPct: 75,
      revenue: 3800,
      purchaseCost: 1500,
      holdingCost: 20,
      truckCost: 100,
      transportCo2: 200,
      storageCo2: 10,
      profit: 2180,
      co2: 210
    };
    render(<RoundResult result={result} />);

    expect(screen.getByText("Round Result")).toBeInTheDocument();
    expect(screen.getByText("Order placed (q)")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("Lost sales")).toBeInTheDocument();
    expect(screen.getByText(/2 \(75% full\)/)).toBeInTheDocument();
    expect(screen.getByText(/Round profit:/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,180/)).toBeInTheDocument();
    expect(screen.getByText(/Round CO₂:/)).toBeInTheDocument();
    expect(screen.getByText(/210 kg/)).toBeInTheDocument();
  });
});
