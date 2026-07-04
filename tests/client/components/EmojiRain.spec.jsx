import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import EmojiRain from "../../../src/components/EmojiRain.jsx";

describe("EmojiRain", () => {
  it("renders the requested number of falling pieces", () => {
    const { container } = render(<EmojiRain count={12} />);
    expect(container.querySelectorAll(".emoji-rain-piece")).toHaveLength(12);
  });

  it("is decorative and non-interactive (aria-hidden)", () => {
    const { container } = render(<EmojiRain count={5} />);
    const root = container.querySelector(".emoji-rain");
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("aria-hidden", "true");
  });

  it("defaults to a non-empty burst", () => {
    const { container } = render(<EmojiRain />);
    expect(container.querySelectorAll(".emoji-rain-piece").length).toBeGreaterThan(0);
  });
});
