function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomUniform(min, max) {
  return Math.round(min + Math.random() * (max - min));
}

function randomNormal(mean, stdDev) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * stdDev;
}

export function sampleDemand(distribution) {
  switch (distribution.type) {
    case "uniform":
      return randomUniform(distribution.min, distribution.max);
    case "normal": {
      const draw = randomNormal(distribution.mean, distribution.stdDev);
      const bounded = clamp(draw, distribution.min, distribution.max);
      return Math.round(bounded);
    }
    default:
      throw new Error(`Unsupported distribution type: ${distribution.type}`);
  }
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
