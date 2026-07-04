import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import RoundInfo from "../../../src/components/RoundInfo.jsx";

const round = { id: 2, title: "Hand 2", distribution: { type: "uniform", min: 80, max: 120 } };
const prices = { wholesaleCost: 10, retailPrice: 40, salvagePrice: 5 };

describe("RoundInfo", () => {
  it("shows the round position and title", () => {
    render(<RoundInfo round={round} totalRounds={5} prices={prices} />);
    expect(screen.getByText("Round 2 / 5")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hand 2" })).toBeInTheDocument();
  });

  it("renders the three price chips with values", () => {
    render(<RoundInfo round={round} totalRounds={5} prices={prices} />);
    expect(screen.getByText("Retail")).toBeInTheDocument();
    expect(screen.getByText("$40")).toBeInTheDocument();
    expect(screen.getByText("Wholesale")).toBeInTheDocument();
    expect(screen.getByText("$10")).toBeInTheDocument();
    expect(screen.getByText("Salvage")).toBeInTheDocument();
    expect(screen.getByText("$5")).toBeInTheDocument();
  });

  it("describes a uniform demand distribution", () => {
    render(<RoundInfo round={round} totalRounds={5} prices={prices} />);
    expect(screen.getByText("Uniform [80, 120]")).toBeInTheDocument();
  });

  it("describes a normal demand distribution", () => {
    const normalRound = {
      ...round,
      distribution: { type: "normal", mean: 100, stdDev: 10, min: 70, max: 130 }
    };
    render(<RoundInfo round={normalRound} totalRounds={5} prices={prices} />);
    expect(screen.getByText("Normal (μ=100, σ=10)")).toBeInTheDocument();
  });
});
