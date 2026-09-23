import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import FleetSweep from "../../../src/components/FleetSweep.jsx";

describe("FleetSweep", () => {
  it("renders the full parallax convoy (far + near + hero)", () => {
    const { container } = render(<FleetSweep />);
    // 5 far + 3 near + 1 hero.
    expect(container.querySelectorAll(".fleet-unit").length).toBe(9);
    expect(container.querySelectorAll(".fleet-hero").length).toBe(1);
  });

  it("is an all-ship convoy while the truck is switched off", () => {
    const { container } = render(<FleetSweep />);
    expect(container.querySelectorAll('.fleet-unit[data-kind="ship"]').length).toBe(9);
    expect(container.querySelectorAll('.fleet-unit[data-kind="truck"]').length).toBe(0);
  });

  it("mixes a few express trucks into the convoy when the truck is on, hero stays a ship", () => {
    const { container } = render(<FleetSweep withTrucks />);
    // 2 far + 1 near slots turn into trucks.
    expect(container.querySelectorAll('.fleet-unit[data-kind="truck"]').length).toBe(3);
    expect(container.querySelector(".fleet-hero").dataset.kind).toBe("ship");
  });

  it("emits billowing smoke clouds and a full-screen haze", () => {
    const { container } = render(<FleetSweep />);
    // far 5x2 + near 3x5 + hero 7 = 32 clouds.
    expect(container.querySelectorAll(".fleet-smoke").length).toBe(32);
    expect(container.querySelector(".exhaust-haze")).not.toBeNull();
  });

  it("drives each vehicle with a per-vehicle scale variable and duration", () => {
    const { container } = render(<FleetSweep withTrucks />);
    for (const unit of container.querySelectorAll(".fleet-unit")) {
      expect(unit.style.getPropertyValue("--scale")).not.toBe("");
      expect(unit.style.animationDuration).not.toBe("");
    }
  });
});
