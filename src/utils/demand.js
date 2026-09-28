// Demand is sampled on the server (server/utils/demand.js); the client only
// shows which distribution the admin set.

// Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7).
function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

// Share of rounds whose normal draw comes out negative — the server counts
// those as zero demand. Φ(−mean/σ); 0 when there is no spread.
export function zeroDemandShare(mean, stdDev) {
  if (!(mean > 0) || !(stdDev > 0)) return 0;
  return normalCdf(-mean / stdDev);
}
export function describeDistribution(distribution) {
  if (distribution.type === "uniform") {
    return `Uniform [${distribution.min}, ${distribution.max}]`;
  }

  if (distribution.type === "normal") {
    return `Normal (μ=${distribution.mean}, σ=${distribution.stdDev})`;
  }

  return "Unknown distribution";
}
