import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoundInfo from "../../../src/components/RoundInfo.jsx";

const round = { id: 2, title: "Round 2", distribution: { type: "uniform", min: 80, max: 120 } };
const config = {
  leadTime: 2,
  price: 40,
  unitCost: 10,
  holdingCost: 1,
  truckCapacity: 100,
  fixedCostPerTruck: 50,
  co2PerTruck: 100,
  expressCapacity: 40,
  expressFixedCost: 120,
  expressCo2: 250,
  co2PerUnitHeld: 0.5
};

describe("RoundInfo", () => {
  it("shows the round position and title", () => {
    render(<RoundInfo round={round} totalRounds={12} config={config} />);
    expect(screen.getByText("Round 2 / 12")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Round 2" })).toBeInTheDocument();
  });

  it("renders the economy, delivery-mode and storage config chips", () => {
    render(<RoundInfo round={round} totalRounds={12} config={config} />);
    expect(screen.getByText("Economics")).toBeInTheDocument();
    expect(screen.getByText("Consolidated truck")).toBeInTheDocument();
    expect(screen.getByText("Express van")).toBeInTheDocument();
    expect(screen.getByText("Storage & risk")).toBeInTheDocument();
    expect(screen.getByText("$40")).toBeInTheDocument();
    expect(screen.getByText("2 rounds")).toBeInTheDocument();
    // Consolidated CO₂ chip value.
    expect(screen.getByText("100 kg")).toBeInTheDocument();
    // Express van economy is surfaced too.
    expect(screen.getByText("$120")).toBeInTheDocument();
    expect(screen.getByText("250 kg")).toBeInTheDocument();
  });

  it("describes a uniform demand distribution", () => {
    render(<RoundInfo round={round} totalRounds={12} config={config} />);
    expect(screen.getByText("Uniform [80, 120]")).toBeInTheDocument();
  });

  it("describes a normal demand distribution", () => {
    const normalRound = {
      ...round,
      distribution: { type: "normal", mean: 100, stdDev: 10, min: 70, max: 130 }
    };
    render(<RoundInfo round={normalRound} totalRounds={12} config={config} />);
    expect(screen.getByText("Normal (μ=100, σ=10)")).toBeInTheDocument();
  });
});
