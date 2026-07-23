import { useMemo } from "react";

// Cinematic round-end convoy: multiple parallax depth layers of delivery trucks
// sweep the screen, a huge hero truck dominates the foreground, all trailing
// heavy billowing smoke, over a building exhaust haze. Purely decorative and
// pure-CSS/SVG (no network, no library), remounted via `key` each round.

// Detailed flat box-truck, cab facing right (direction of travel). Colors come
// from the app's CSS variables so it recolors with the theme. Smoke is emitted
// by the parent at the truck's rear (left).
function TruckArt({ label = false }) {
  return (
    <svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true">
      {/* exhaust stack behind the cab */}
      <rect x="150" y="6" width="7" height="30" rx="2" fill="#3f3f3f" />
      {/* trailer box */}
      <rect x="8" y="24" width="140" height="64" rx="6" fill="var(--surface)" stroke="var(--line)" strokeWidth="3" />
      {/* panel seams */}
      <g stroke="var(--line)" strokeWidth="2" opacity="0.8">
        <line x1="45" y1="24" x2="45" y2="88" />
        <line x1="82" y1="24" x2="82" y2="88" />
        <line x1="119" y1="24" x2="119" y2="88" />
      </g>
      {/* accent stripe — gold when it carries the Black Sea Gold wordmark */}
      <rect x="12" y="46" width="132" height="16" fill={label ? "var(--gold)" : "var(--accent)"} />
      {label && (
        <text x="78" y="59" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" letterSpacing="0.5">
          BLACK SEA GOLD
        </text>
      )}
      {/* cab */}
      <path d="M148 34 h30 l24 26 v28 h-54 z" fill="var(--accent)" />
      <path d="M148 34 h30 l24 26 v28 h-54 z" fill="none" stroke="var(--accent-dark)" strokeWidth="2" />
      {/* windshield */}
      <path d="M180 40 h13 l15 15 h-28 z" fill="#cdeafd" />
      {/* headlight + bumper */}
      <circle cx="200" cy="80" r="4" fill="#ffe6a1" />
      <rect x="196" y="86" width="14" height="6" rx="2" fill="var(--accent-dark)" />
      {/* wheels */}
      <g>
        <circle cx="48" cy="92" r="15" fill="#222" />
        <circle cx="48" cy="92" r="6" fill="#8a8a8a" />
        <circle cx="176" cy="92" r="15" fill="#222" />
        <circle cx="176" cy="92" r="6" fill="#8a8a8a" />
      </g>
    </svg>
  );
}

// Depth layers, back to front. The hero is appended separately.
const LAYERS = [
  { key: "far", count: 5, scaleMin: 0.3, scaleRange: 0.16, opacity: 0.4, topMin: 6, topRange: 40, durMin: 3.4, durRange: 0.8, delaySpread: 1.4, smoke: 2, big: false },
  { key: "near", count: 3, scaleMin: 0.75, scaleRange: 0.4, opacity: 1, topMin: 44, topRange: 28, durMin: 2.7, durRange: 0.6, delaySpread: 0.9, smoke: 5, big: true }
];

function makeSmoke(count, big) {
  return Array.from({ length: count }, (_, i) => {
    const size = big ? 60 + Math.random() * 80 : 22 + Math.random() * 22;
    return {
      id: i,
      size,
      puffX: size * 1.15,
      puffY: size * 0.7,
      delay: i * 0.22 + Math.random() * 0.12,
      duration: (big ? 1.5 : 1.1) + Math.random() * 0.5
    };
  });
}

function TruckSweep() {
  const trucks = useMemo(() => {
    const list = [];
    let id = 0;

    for (const layer of LAYERS) {
      for (let i = 0; i < layer.count; i += 1) {
        const scale = layer.scaleMin + Math.random() * layer.scaleRange;
        list.push({
          id: id++,
          layer: layer.key,
          top: layer.topMin + Math.random() * layer.topRange,
          scale,
          opacity: layer.opacity,
          delay: (i / layer.count) * layer.delaySpread + Math.random() * 0.12,
          duration: layer.durMin + Math.random() * layer.durRange,
          zIndex: Math.round(scale * 100),
          // Whole fleet carries the Black Sea Gold wordmark on a gold stripe.
          label: true,
          smoke: makeSmoke(layer.smoke, layer.big)
        });
      }
    }

    // Hero: huge, foreground, deterministic timing so the screen shake can sync.
    list.push({
      id: id++,
      layer: "hero",
      top: 40,
      scale: 1.8,
      opacity: 1,
      delay: 0.8,
      duration: 3,
      zIndex: 200,
      label: true,
      smoke: makeSmoke(7, true)
    });

    return list;
  }, []);

  return (
    <div className="truck-sweep" aria-hidden="true">
      <div className="exhaust-haze" />
      {trucks.map((t) => (
        <div
          key={t.id}
          className={`truck-unit truck-${t.layer}`}
          style={{
            top: `${t.top}vh`,
            zIndex: t.zIndex,
            opacity: t.opacity,
            "--scale": t.scale,
            animationDelay: `${t.delay}s`,
            animationDuration: `${t.duration}s`
          }}
        >
          <div className="truck-art">
            <TruckArt label={t.label} />
          </div>
          {t.smoke.map((s) => (
            <span
              key={s.id}
              className="truck-smoke"
              style={{
                width: `${s.size}px`,
                height: `${s.size}px`,
                "--puff-x": `${s.puffX}px`,
                "--puff-y": `${s.puffY}px`,
                animationDelay: `${t.delay + s.delay}s`,
                animationDuration: `${s.duration}s`
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default TruckSweep;
