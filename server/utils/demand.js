function randomUniform(min, max, rand) {
  return Math.round(min + rand() * (max - min));
}

function randomNormal(mean, stdDev, rand) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v); //1/sqrt(2 * Math.PI) * exp(-0.5 * z * z)
  return mean + z * stdDev;
}

export function sampleDemand(distribution, rand = Math.random) {
  switch (distribution.type) {
    case "uniform":
      return randomUniform(distribution.min, distribution.max, rand);
    case "normal":
      // Negative draws map straight to 0 (no resampling).
      return Math.max(0, Math.round(randomNormal(distribution.mean, distribution.stdDev, rand)));
    default:
      throw new Error(`Unsupported distribution type: ${distribution.type}`);
  }
}
