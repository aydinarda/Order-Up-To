// Demand is sampled on the server (server/utils/demand.js); the client only
// shows which distribution the admin set.
export function describeDistribution(distribution) {
  if (distribution.type === "uniform") {
    return `Uniform [${distribution.min}, ${distribution.max}]`;
  }

  if (distribution.type === "normal") {
    return `Normal (μ=${distribution.mean}, σ=${distribution.stdDev})`;
  }

  return "Unknown distribution";
}
