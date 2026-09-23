import { useMemo } from "react";

// Cinematic round-end convoy: multiple parallax depth layers of cargo ships
// sweep the screen, a huge hero ship dominates the foreground, all trailing
// heavy billowing smoke, over a building exhaust haze. While the admin has the
// fast truck switched on, a few express trucks join the convoy. Purely
// decorative and pure-CSS/SVG (no network, no library), remounted via `key`
// each round.

// Flat container ship, bow facing right (direction of travel), sitting in a
// strip of water. Colors come from the app's CSS variables so it recolors with
// the theme. Smoke is emitted by the parent at the funnel mouth (SHIP_FUNNEL).
const SHIP_FUNNEL = { x: 49.5, y: 4 };
const CONTAINER_COLORS = ["var(--primary)", "var(--gold)", "var(--sea)", "var(--hazelnut)"];
const WAVE_PATH = `M0 100 q5.5 -4 11 0${" t11 0".repeat(19)}`;

function ShipArt() {
  return (
    <svg viewBox="0 0 220 120" width="220" height="120" aria-hidden="true">
      {/* water */}
      <rect x="0" y="98" width="220" height="22" fill="var(--sea)" opacity="0.3" />
      {/* funnel (behind the bridge) with a gold band */}
      <rect x="44" y="4" width="11" height="24" rx="1.5" fill="var(--hazelnut)" />
      <rect x="44" y="9" width="11" height="4" fill="var(--gold)" />
      {/* bridge / superstructure at the stern */}
      <rect x="20" y="30" width="40" height="34" rx="2" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
      <rect x="24" y="36" width="32" height="7" rx="1" fill="#cdeafd" />
      <rect x="26" y="20" width="24" height="12" rx="2" fill="var(--surface)" stroke="var(--line)" strokeWidth="2" />
      {/* stacked cargo containers */}
      {[66, 92, 118, 144, 170].map((x, i) => (
        <rect
          key={`low-${x}`}
          x={x}
          y="50"
          width="24"
          height="13"
          fill={CONTAINER_COLORS[i % CONTAINER_COLORS.length]}
          stroke="rgba(0, 0, 0, 0.18)"
          strokeWidth="1"
        />
      ))}
      {[79, 105, 131, 157].map((x, i) => (
        <rect
          key={`high-${x}`}
          x={x}
          y="37"
          width="24"
          height="13"
          fill={CONTAINER_COLORS[(i + 2) % CONTAINER_COLORS.length]}
          stroke="rgba(0, 0, 0, 0.18)"
          strokeWidth="1"
        />
      ))}
      {/* hull with the Black Sea Gold wordmark on a gold stripe */}
      <rect x="8" y="61" width="206" height="6" rx="1" fill="var(--hazelnut)" />
      <path d="M8 66 H214 L194 102 H26 Z" fill="var(--hazelnut-dark)" />
      <path d="M12 74 H209.5 L203 86 H18 Z" fill="var(--gold)" />
      <text x="110" y="83.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" letterSpacing="0.5">
        BLACK SEA GOLD
      </text>
      {/* waterline */}
      <path d={WAVE_PATH} fill="none" stroke="var(--surface)" strokeWidth="2.5" opacity="0.75" />
    </svg>
  );
}

// Detailed flat box-truck, cab facing right (direction of travel). Smoke is
// emitted by the parent at the truck's rear (left) — the CSS default origin.
function TruckArt() {
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
      {/* gold stripe carrying the Black Sea Gold wordmark */}
      <rect x="12" y="46" width="132" height="16" fill="var(--gold)" />
      <text x="78" y="59" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" letterSpacing="0.5">
        BLACK SEA GOLD
      </text>
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

// Which slots of each layer turn into express trucks while the truck is on.
const TRUCK_SLOTS = { far: [1, 3], near: [1] };

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

// A ship's plume is centered on its funnel mouth; a truck keeps the CSS
// default (rear exhaust).
function smokeOrigin(kind, size) {
  if (kind !== "ship") {
    return {};
  }
  return { left: `${SHIP_FUNNEL.x - size / 2}px`, top: `${SHIP_FUNNEL.y - size / 2}px` };
}

function FleetSweep({ withTrucks = false }) {
  const units = useMemo(() => {
    const list = [];
    let id = 0;

    for (const layer of LAYERS) {
      for (let i = 0; i < layer.count; i += 1) {
        const scale = layer.scaleMin + Math.random() * layer.scaleRange;
        list.push({
          id: id++,
          layer: layer.key,
          kind: withTrucks && TRUCK_SLOTS[layer.key]?.includes(i) ? "truck" : "ship",
          top: layer.topMin + Math.random() * layer.topRange,
          scale,
          opacity: layer.opacity,
          delay: (i / layer.count) * layer.delaySpread + Math.random() * 0.12,
          duration: layer.durMin + Math.random() * layer.durRange,
          zIndex: Math.round(scale * 100),
          smoke: makeSmoke(layer.smoke, layer.big)
        });
      }
    }

    // Hero: always a huge foreground ship, deterministic timing so the screen
    // shake can sync.
    list.push({
      id: id++,
      layer: "hero",
      kind: "ship",
      top: 40,
      scale: 1.8,
      opacity: 1,
      delay: 0.8,
      duration: 3,
      zIndex: 200,
      smoke: makeSmoke(7, true)
    });

    return list;
  }, [withTrucks]);

  return (
    <div className="fleet-sweep" aria-hidden="true">
      <div className="exhaust-haze" />
      {units.map((u) => (
        <div
          key={u.id}
          className={`fleet-unit fleet-${u.layer}`}
          data-kind={u.kind}
          style={{
            top: `${u.top}vh`,
            zIndex: u.zIndex,
            opacity: u.opacity,
            "--scale": u.scale,
            animationDelay: `${u.delay}s`,
            animationDuration: `${u.duration}s`
          }}
        >
          <div className="fleet-art">{u.kind === "ship" ? <ShipArt /> : <TruckArt />}</div>
          {u.smoke.map((s) => (
            <span
              key={s.id}
              className="fleet-smoke"
              style={{
                ...smokeOrigin(u.kind, s.size),
                width: `${s.size}px`,
                height: `${s.size}px`,
                "--puff-x": `${s.puffX}px`,
                "--puff-y": `${s.puffY}px`,
                animationDelay: `${u.delay + s.delay}s`,
                animationDuration: `${s.duration}s`
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default FleetSweep;
