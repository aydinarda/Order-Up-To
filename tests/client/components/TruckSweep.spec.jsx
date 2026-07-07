import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import TruckSweep from "../../../src/components/TruckSweep.jsx";

describe("TruckSweep", () => {
  it("renders the full parallax convoy (far + near + hero)", () => {
    const { container } = render(<TruckSweep />);
    // 5 far + 3 near + 1 hero.
    expect(container.querySelectorAll(".truck-unit").length).toBe(9);
    expect(container.querySelectorAll(".truck-hero").length).toBe(1);
  });

  it("emits billowing smoke clouds and a full-screen haze", () => {
    const { container } = render(<TruckSweep />);
    // far 5x2 + near 3x5 + hero 7 = 32 clouds.
    expect(container.querySelectorAll(".truck-smoke").length).toBe(32);
    expect(container.querySelector(".exhaust-haze")).not.toBeNull();
  });

  it("drives each truck with a per-truck scale variable and duration", () => {
    const { container } = render(<TruckSweep />);
    for (const unit of container.querySelectorAll(".truck-unit")) {
      expect(unit.style.getPropertyValue("--scale")).not.toBe("");
      expect(unit.style.animationDuration).not.toBe("");
    }
  });
});
