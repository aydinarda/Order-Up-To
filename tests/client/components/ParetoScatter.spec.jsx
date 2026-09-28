import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ParetoScatter, { placeLabels } from "../../../src/components/ParetoScatter.jsx";

const rows = [
  { nickname: "Alice", cumProfit: 3800, cumCo2: 100, front: 1 },
  { nickname: "Bob", cumProfit: 2750, cumCo2: 200, front: 2 },
  { nickname: "Carol", cumProfit: 1150, cumCo2: 400, front: 3 }
];

describe("ParetoScatter", () => {
  it("renders one dot per player", () => {
    const { container } = render(<ParetoScatter rows={rows} selfNickname="Bob" />);
    expect(container.querySelectorAll('[data-testid="pareto-dot"]').length).toBe(3);
  });

  it("highlights the viewing player's dot", () => {
    render(<ParetoScatter rows={rows} selfNickname="Bob" />);
    expect(screen.getByText(/Bob \(you\)/)).toBeInTheDocument();
  });

  it("shows a placeholder message with fewer than two players", () => {
    render(<ParetoScatter rows={[rows[0]]} selfNickname="Alice" />);
    expect(screen.getByText(/at least two players/i)).toBeInTheDocument();
  });

  it("survives empty rows without crashing", () => {
    render(<ParetoScatter rows={[]} selfNickname="Alice" />);
    expect(screen.getByText(/at least two players/i)).toBeInTheDocument();
  });

  it("plots any chosen pair of KPIs with matching labels and good direction", () => {
    const kpiRows = [
      { nickname: "Alice", cumBackorders: 10, serviceLevelPct: 95, front: 1 },
      { nickname: "Bob", cumBackorders: 5, serviceLevelPct: 80, front: 1 },
      { nickname: "Carol", cumBackorders: 80, serviceLevelPct: 60, front: 2 }
    ];
    const { container } = render(
      <ParetoScatter rows={kpiRows} selfNickname="Bob" axes={{ x: "backorders", y: "serviceLevel" }} />
    );
    expect(screen.getByRole("heading", { name: /service level vs backorders/i })).toBeInTheDocument();
    expect(screen.getByText(/Backorders \(units\)/)).toBeInTheDocument();
    expect(screen.getByText(/Service level \(%\)/)).toBeInTheDocument();
    expect(screen.getByText(/Up-left is the good direction: higher service level, fewer backorders/)).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="pareto-dot"]').length).toBe(3);
  });

  it("leaves out players without a service level yet", () => {
    const kpiRows = [
      { nickname: "Alice", cumProfit: 100, serviceLevelPct: null, front: 1 },
      { nickname: "Bob", cumProfit: 50, serviceLevelPct: null, front: 1 }
    ];
    render(<ParetoScatter rows={kpiRows} axes={{ x: "serviceLevel", y: "profit" }} />);
    expect(screen.getByText(/service level starts after the first round with demand/i)).toBeInTheDocument();
  });

  it("gives players on the very same spot one shared label", () => {
    const same = [
      { nickname: "Green03", cumProfit: 3000, cumCo2: 150, front: 1 },
      { nickname: "Green08", cumProfit: 3000, cumCo2: 150, front: 1 },
      { nickname: "Green13", cumProfit: 3000, cumCo2: 150, front: 1 },
      { nickname: "Base01", cumProfit: 3500, cumCo2: 400, front: 1 }
    ];
    const { container } = render(<ParetoScatter rows={same} selfNickname="Base01" />);
    const labels = [...container.querySelectorAll('[data-testid="pareto-label"]')].map((n) => n.textContent);
    expect(labels).toContain("Green03 +2");
    expect(labels).toContain("Base01 (you)");
    expect(labels).not.toContain("Green08");
  });

  it("always labels the viewing player, even in a crowded cluster", () => {
    // 30 near-identical players plus two outliers that stretch the axes, so
    // the cluster really is packed into a few pixels.
    const crowd = [
      ...Array.from({ length: 30 }, (_, i) => ({
        nickname: `Bot${i}`,
        cumProfit: 3000 + i * 0.5,
        cumCo2: 200 - i * 0.2,
        front: 1
      })),
      { nickname: "Low", cumProfit: 0, cumCo2: 0, front: 1 },
      { nickname: "High", cumProfit: 9000, cumCo2: 2000, front: 1 }
    ];
    const { container } = render(<ParetoScatter rows={crowd} selfNickname="Bot17" />);
    const labels = [...container.querySelectorAll('[data-testid="pareto-label"]')].map((n) => n.textContent);
    // Bot17 shares its pixel with most of the cluster: "Bot17 (you) +N".
    expect(labels.some((l) => l.startsWith("Bot17 (you)"))).toBe(true);
    expect(labels.length).toBeLessThan(10); // the rest stay in tooltips + table
  });
});

describe("placeLabels", () => {
  const bounds = { left: 0, right: 640, top: 0, bottom: 400 };
  const boxOf = (l) => {
    const w = l.text.length * 6.4;
    const left = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
    return { left, right: left + w, top: l.y - 10, bottom: l.y + 3 };
  };
  const overlap = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);

  it("never lets two placed labels overlap", () => {
    const labels = Array.from({ length: 12 }, (_, i) => ({ text: `Player${i}`, cx: 300 + i * 3, cy: 200 + i * 2 }));
    const placed = placeLabels(labels, bounds);
    expect(placed.length).toBeGreaterThan(1);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlap(boxOf(placed[i]), boxOf(placed[j]))).toBe(false);
      }
    }
  });

  it("moves a label to the left when the right side would leave the chart", () => {
    const [placed] = placeLabels([{ text: "EdgePlayer", cx: 630, cy: 200 }], bounds);
    expect(placed.anchor).toBe("end");
  });

  it("prefers a slot that does not cover a neighbouring dot", () => {
    // A neighbour sits right where the preferred (right-above) slot would go.
    const [placed] = placeLabels([{ text: "Me", cx: 300, cy: 200 }], bounds, [
      { cx: 300, cy: 200 },
      { cx: 318, cy: 190 }
    ]);
    expect(placed.x === 311 && placed.y === 192).toBe(false);
  });

  it("places the first label (the viewing player) first choice", () => {
    const [first] = placeLabels([{ text: "you", cx: 300, cy: 200 }], bounds);
    expect(first).toMatchObject({ x: 311, y: 192, anchor: "start" });
  });
});
