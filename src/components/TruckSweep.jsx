import { useMemo } from "react";

// A decorative convoy of delivery trucks that sweeps the screen at each round
// transition, each leaving a fading exhaust trail — echoing "every shipment is a
// truck is an emission". Purely cosmetic (fixed count, not tied to actual trucks
// dispatched). Pure-CSS/SVG, no network, remounted via `key` on each round.

// Themed flat box-truck, cab facing right (direction of travel). Colors are
// driven by the app's CSS variables so it recolors with the theme. The exhaust
// pipe sits at the back-left; smoke is emitted there by the parent.
function TruckArt() {
  return (
    <svg viewBox="0 0 120 66" width="120" height="66" aria-hidden="true">
      {/* exhaust pipe (back-left, top) */}
      <rect x="4" y="8" width="4" height="8" rx="1.5" fill="#4a4a4a" opacity="0.7" />
      {/* trailer box */}
      <rect x="4" y="14" width="72" height="34" rx="4" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
      {/* accent stripe */}
      <rect x="6" y="26" width="68" height="8" fill="var(--accent)" opacity="0.9" />
      {/* cab */}
      <path d="M76 20 h18 l14 14 v14 h-32 z" fill="var(--accent)" />
      <path d="M76 20 h18 l14 14 v14 h-32 z" fill="none" stroke="var(--accent-dark)" strokeWidth="1.5" />
      {/* windshield */}
      <path d="M92 24 h5 l8.5 8.5 h-13.5 z" fill="#cdeafd" />
      {/* wheels */}
      <circle cx="26" cy="50" r="8" fill="#2b2b2b" />
      <circle cx="26" cy="50" r="3.4" fill="#8a8a8a" />
      <circle cx="90" cy="50" r="8" fill="#2b2b2b" />
      <circle cx="90" cy="50" r="3.4" fill="#8a8a8a" />
    </svg>
  );
}

function TruckSweep({ count = 8 }) {
  // Randomized once per mount; remounted via `key` on each round transition.
  const trucks = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const scale = 0.55 + Math.random() * 0.5;
        return {
          id: i,
          top: 52 + Math.random() * 30, // vh — lower band, like a road
          scale,
          delay: i * 0.16 + Math.random() * 0.08, // s — convoy stagger
          duration: 2.6 + Math.random() * 0.7, // s — bigger = a touch faster feel
          z: Math.round(scale * 100) // nearer trucks (bigger) draw on top
        };
      }),
    [count]
  );

  return (
    <div className="truck-sweep" aria-hidden="true">
      {trucks.map((t) => (
        <div
          key={t.id}
          className="truck-unit"
          style={{
            top: `${t.top}vh`,
            zIndex: t.z,
            "--scale": t.scale,
            animationDelay: `${t.delay}s`,
            animationDuration: `${t.duration}s`
          }}
        >
          <div className="truck-art">
            <TruckArt />
          </div>
          {/* exhaust puffs emitted at the back-left of the truck */}
          {[0, 1, 2].map((p) => (
            <span
              key={p}
              className="truck-smoke"
              style={{ animationDelay: `${t.delay + p * 0.28}s` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default TruckSweep;
