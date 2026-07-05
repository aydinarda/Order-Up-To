import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TruckSweep from "../../../src/components/TruckSweep.jsx";

describe("TruckSweep", () => {
  it("renders the requested number of trucks", () => {
    const { container } = render(<TruckSweep count={8} />);
    expect(container.querySelectorAll(".truck-unit").length).toBe(8);
  });

  it("emits smoke puffs behind each truck", () => {
    const { container } = render(<TruckSweep count={3} />);
    expect(container.querySelectorAll(".truck-unit").length).toBe(3);
    // 3 puffs per truck.
    expect(container.querySelectorAll(".truck-smoke").length).toBe(9);
  });

  it("drives each truck with a staggered scale variable", () => {
    const { container } = render(<TruckSweep count={2} />);
    const units = container.querySelectorAll(".truck-unit");
    for (const unit of units) {
      expect(unit.style.getPropertyValue("--scale")).not.toBe("");
      expect(unit.style.animationDuration).not.toBe("");
    }
  });
});
