import { createGradientNoise, createTerrainNoise } from './noise.js';

const PROFILES = {
  hills: {
    label: 'Rolling hills',
    palette: { low: 0x86ad6c, high: 0xb2bf87, rock: 0x899581, sand: 0xd9ceaa, tree: 0x397c59 },
  },
  ridges: {
    label: 'Alpine ridges',
    palette: { low: 0x728b65, high: 0xc1c5b6, rock: 0x747f7e, sand: 0xbcb99f, tree: 0x315b49 },
  },
  mesas: {
    label: 'Terraced mesas',
    palette: { low: 0xbb965f, high: 0xd6bb83, rock: 0x9b7351, sand: 0xe1cca0, tree: 0x687c43 },
  },
  caldera: {
    label: 'Volcanic caldera',
    palette: { low: 0x6d906b, high: 0x858782, rock: 0x555e5b, sand: 0xa8a58b, tree: 0x426e50 },
  },
};

const clamp = (x, low = 0, high = 1) => Math.min(high, Math.max(low, x));
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Natural terrain only. The road corridor and coastline are blended by terrain.js.
export function createLandscape(seed, {
  terrainStyle = 'hills',
  frequency = 0.004,
  octaves = 4,
  persistence = 0.5,
  terrain = 32,
  footprintRadius = 500,
} = {}) {
  if (!Object.hasOwn(PROFILES, terrainStyle)) {
    throw new RangeError(`Unsupported terrain style: ${terrainStyle}`);
  }
  if (!Number.isFinite(terrain) || terrain < 0 ||
      !Number.isFinite(footprintRadius) || footprintRadius <= 0) {
    throw new RangeError('Terrain relief must be nonnegative and footprintRadius must be positive.');
  }

  // Also validates frequency, octaves and persistence consistently with the track noise.
  const detail = createTerrainNoise(`${seed}:landscape-detail`, { frequency, octaves, persistence });
  const macro = createGradientNoise(`${seed}:landscape-macro`);
  const warpX = createGradientNoise(`${seed}:landscape-warp-x`);
  const warpZ = createGradientNoise(`${seed}:landscape-warp-z`);
  const ridges = createGradientNoise(`${seed}:landscape-ridges`);
  const moisture = createGradientNoise(`${seed}:landscape-moisture`);
  const key = createGradientNoise(`${seed}:landscape-shape`);
  const pick = (i) => (key(13.37 + i * 3.71, -8.23 + i * 1.19) + 1) / 2;
  const phase = pick(1) * Math.PI * 2;
  const direction = pick(2) * Math.PI * 2;
  const cos = Math.cos(direction);
  const sin = Math.sin(direction);
  const craterX = (pick(3) - 0.5) * footprintRadius * 0.12;
  const craterZ = (pick(4) - 0.5) * footprintRadius * 0.12;
  const craterRadius = footprintRadius * (0.38 + pick(5) * 0.1);
  const eccentricity = 0.9 + pick(6) * 0.2;
  const amplitude = terrain * 2.5;
  const ridgeLayers = Array.from({ length: octaves }, (_, i) => ({
    frequency: frequency * 2 ** i,
    amplitude: persistence ** i,
  }));
  const coastPhases = Array.from({ length: 4 }, (_, i) => pick(i + 10) * Math.PI * 2);

  function warp(x, z) {
    // A wavelength-relative world-space displacement keeps warping effective when
    // the frequency slider changes, without moving the large caldera off-island.
    const strength = Math.min(footprintRadius * 0.12, 0.24 / frequency);
    const f = frequency * 0.42;
    const wx = x + warpX(x * f + 8.3, z * f - 3.1) * strength;
    const wz = z + warpZ(x * f - 5.7, z * f + 6.4) * strength;
    return [wx * cos - wz * sin, wx * sin + wz * cos];
  }

  function shapeAt(x, z) {
    const [u, v] = warp(x, z);
    const broad = macro(u * frequency * 0.48 + 5.31, v * frequency * 0.48 - 7.67);

    if (terrainStyle === 'hills') {
      const n = detail(u, v);
      return clamp(0.42 + broad * 0.55 + n * 0.22, 0.03, 1.1);
    }

    if (terrainStyle === 'ridges') {
      let sum = 0;
      let weights = 0;
      let weight = 1;
      for (const layer of ridgeLayers) {
        const n = ridges(u * layer.frequency * 0.65 + 19.2, v * layer.frequency * 1.25 - 11.4);
        const ridge = (1 - Math.abs(n)) ** 2;
        sum += ridge * weight * layer.amplitude;
        weights += layer.amplitude;
        // Lower ridges inherit the mountain chain of the preceding octave.
        weight = clamp(ridge * 1.7);
      }
      return 0.05 + clamp((sum / weights - 0.25) / 0.75) ** 1.5 * 1.65;
    }

    if (terrainStyle === 'mesas') {
      const field = clamp(0.5 + broad * 0.72 +
        Math.sin((u + v * 0.35) * frequency * 0.65 + phase) * 0.12, 0.01, 0.99);
      const level = field * 4;
      const step = smooth(0.33, 0.67, level - Math.floor(level));
      // Most of each tier is exactly flat. Only the transition has erosion detail.
      return 0.06 + (Math.floor(level) + step) / 4 * 1.25 +
        detail(u, v) * step * (1 - step) * 0.06;
    }

    // A footprint-scaled macroform keeps the crater visible on large and small tracks.
    const cx = (x - craterX) * eccentricity;
    const cz = (z - craterZ) / eccentricity;
    const angle = Math.atan2(cz, cx);
    const warpedRadius = craterRadius * (1 + 0.07 * Math.sin(angle * 3 + phase));
    const r = Math.hypot(cx, cz) / warpedRadius;
    const ring = Math.exp(-(((r - 1) / 0.23) ** 2));
    const skirt = Math.exp(-(((r - 1.37) / 0.65) ** 2));
    const n = detail(u, v);
    return 0.04 + ring * (1.32 + broad * 0.13) + skirt * 0.2 +
      (n + 1) * 0.035 * smooth(0.45, 0.85, r);
  }

  function heightAt(x, z) {
    return terrain === 0 ? 5 : 5 + amplitude * shapeAt(x, z);
  }

  function coastFactor(angle) {
    // Integer harmonics make the coast exactly periodic, including its derivative.
    return 1 + 0.045 * Math.sin(2 * angle + coastPhases[0]) +
      0.028 * Math.sin(3 * angle + coastPhases[1]) +
      0.017 * Math.sin(5 * angle + coastPhases[2]) +
      0.01 * Math.sin(7 * angle + coastPhases[3]);
  }

  function vegetationAt(x, z) {
    const wet = clamp(0.5 + moisture(x * frequency * 0.7 + 3.4, z * frequency * 0.7 - 6.1));
    const height = terrain === 0 ? 0 : shapeAt(x, z);
    if (terrainStyle === 'mesas') return clamp(0.08 + wet * 0.25 - height * 0.08);
    if (terrainStyle === 'ridges') return clamp((0.28 + wet * 0.7) * (1 - smooth(0.65, 1.3, height)));
    if (terrainStyle === 'caldera') return clamp((0.22 + wet * 0.65) * (1 - smooth(0.45, 1.25, height)));
    return clamp(0.38 + wet * 0.6 - height * 0.12);
  }

  return {
    heightAt,
    coastFactor,
    coastBounds: { min: 0.9, max: 1.1 },
    vegetationAt,
    palette: { ...PROFILES[terrainStyle].palette },
    style: terrainStyle,
    label: PROFILES[terrainStyle].label,
  };
}
