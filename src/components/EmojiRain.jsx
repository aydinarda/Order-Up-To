import { useMemo } from "react";

// Tropical + money theme. Pure-CSS falling animation, no network, no server load.
const EMOJIS = ["💵", "💰", "🤑", "🌺", "👕", "🍍", "🌴", "🤙", "🏝️"];

function EmojiRain({ count = 40 }) {
  // Randomized once per mount; we remount via `key` on each round transition.
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
        left: Math.random() * 100, // vw
        delay: Math.random() * 0.6, // s
        duration: 2.2 + Math.random() * 1.4, // s
        drift: (Math.random() * 2 - 1) * 60, // px horizontal drift
        rotate: (Math.random() * 2 - 1) * 260, // deg
        size: 1.4 + Math.random() * 1.6 // rem
      })),
    [count]
  );

  return (
    <div className="emoji-rain" aria-hidden="true">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="emoji-rain-piece"
          style={{
            left: `${p.left}vw`,
            fontSize: `${p.size}rem`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--drift": `${p.drift}px`,
            "--rotate": `${p.rotate}deg`
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}

export default EmojiRain;
