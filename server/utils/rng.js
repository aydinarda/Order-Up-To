// Deterministic RNG so a game's demand series is reproducible from its seed
// (classroom fairness, debugging, and "replay the same season" debriefs).

export function deriveSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// mulberry32: tiny, fast, good-enough statistical quality for game demand.
export function createRng(seed) {
  let state = seed >>> 0;
  return function rand() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
