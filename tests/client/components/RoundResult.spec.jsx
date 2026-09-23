import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoundResult from "../../../src/components/RoundResult.jsx";

describe("RoundResult", () => {
  it("renders nothing without a result", () => {
    const { container } = render(<RoundResult result={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the order/sales breakdown, backorders, CO2 and profit", () => {
    const result = {
      arrival: 40,
      realizedDemand: 95,
      sold: 95,
      servedOnTime: 90,
      backlogFilled: 5,
      newBackorders: 7,
      backorderEnd: 7,
      onHandEnd: -7,
      orderQty: 150,
      consolidatedQty: 110,
      expressQty: 40,
      trucks: 2,
      vans: 1,
      truckFillPct: 75,
      revenue: 3800,
      purchaseCost: 1500,
      holdingCost: 0,
      backorderCost: 35,
      truckCost: 220,
      transportCo2: 450,
      storageCo2: 10,
      profit: 2060,
      co2: 460
    };
    render(<RoundResult result={result} />);

    expect(screen.getByText("Round Result")).toBeInTheDocument();
    expect(screen.getByText("Order placed (q)")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getByText("Backorders filled")).toBeInTheDocument();
    expect(screen.getByText("New backorders")).toBeInTheDocument();
    expect(screen.getByText("Open backorders")).toBeInTheDocument();
    expect(screen.getByText("-7")).toBeInTheDocument(); // negative net on-hand
    expect(screen.getByText("Backorder penalty")).toBeInTheDocument();
    expect(screen.getByText("$35")).toBeInTheDocument();
    // Both legs of the mixed order are itemised.
    expect(screen.getByText(/110 kg · 2 trucks/)).toBeInTheDocument();
    expect(screen.getByText(/40 kg · 1 van/)).toBeInTheDocument();
    expect(screen.getByText(/75% full/)).toBeInTheDocument();
    expect(screen.getByText(/Round profit:/)).toBeInTheDocument();
    expect(screen.getByText(/\$2,060/)).toBeInTheDocument();
    expect(screen.getByText(/Round CO₂:/)).toBeInTheDocument();
    expect(screen.getByText(/460 kg/)).toBeInTheDocument();
  });

  it("renders an old single-mode express result via the fallback fields", () => {
    const result = {
      arrival: 0,
      realizedDemand: 10,
      sold: 10,
      newBackorders: 0,
      onHandEnd: 5,
      orderQty: 80,
      mode: "express",
      trucks: 2, // old shape: `trucks` held the van count
      truckFillPct: 100,
      revenue: 400,
      purchaseCost: 800,
      holdingCost: 5,
      truckCost: 240,
      transportCo2: 500,
      storageCo2: 2.5,
      profit: -645,
      co2: 502.5
    };
    render(<RoundResult result={result} />);

    expect(screen.getByText(/80 kg · 2 vans/)).toBeInTheDocument();
  });
});
