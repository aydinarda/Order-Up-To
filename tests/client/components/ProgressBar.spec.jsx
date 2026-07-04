import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressBar from "../../../src/components/ProgressBar.jsx";

describe("ProgressBar", () => {
  it("shows the season progress counter", () => {
    render(<ProgressBar currentRound={2} totalRounds={5} />);
    expect(screen.getByText("Season Progress")).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument();
  });

  it("sets the fill width to the completion percentage", () => {
    const { container } = render(<ProgressBar currentRound={2} totalRounds={5} />);
    const fill = container.querySelector(".progress-fill");
    expect(fill).toHaveStyle({ width: "40%" });
  });
});
