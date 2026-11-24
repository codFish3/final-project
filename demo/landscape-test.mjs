import assert from 'node:assert/strict';
import { createLandscape } from './landscape.js';

const styles = ['hills', 'ridges', 'mesas', 'caldera'];
const seeds = ['2401', '5660', 'terrain-review'];
const metrics = [];

function inspect(landscape) {
  let count = 0;
  let flat = 0;
  let roughness = 0;
  let vegetation = 0;
  const heights = [];
  for (let x = -400; x <= 400; x += 20) {
    for (let z = -400; z <= 400; z += 20) {
      const y = landscape.heightAt(x, z);
      assert.ok(Number.isFinite(y) && y >= 3, 'finite dryland height');
      const slope = Math.hypot(landscape.heightAt(x + 1, z) - y, landscape.heightAt(x, z + 1) - y);
      const probability = landscape.vegetationAt(x, z);
      assert.ok(Number.isFinite(probability) && probability >= 0 && probability <= 1);
      flat += Number(slope < 0.01);
      roughness += slope;
      vegetation += probability;
      heights.push(y);
      count++;
    }
  }
  return { flat: flat / count, roughness: roughness / count, vegetation: vegetation / count, heights };
}

for (const seed of seeds) {
  const results = {};
  for (const terrainStyle of styles) {
    const options = { terrainStyle, terrain: 32, footprintRadius: 500 };
    const landscape = createLandscape(seed, options);
    const replay = createLandscape(seed, options);
    const changed = createLandscape(`${seed}-changed`, options);
    const flat = createLandscape(seed, { ...options, terrain: 0 });
    const current = inspect(landscape);
    results[terrainStyle] = current;

    assert.equal(landscape.style, terrainStyle);
    for (const color of Object.values(landscape.palette)) assert.ok(Number.isInteger(color));
    let seedDifference = 0;
    for (let i = 0; i < 100; i++) {
      const x = (i - 50) * 9.37;
      const z = ((i % 17) - 8) * 35.91;
      assert.equal(landscape.heightAt(x, z), replay.heightAt(x, z), 'reproducible height');
      assert.equal(landscape.vegetationAt(x, z), replay.vegetationAt(x, z));
      assert.equal(flat.heightAt(x, z), 5, 'zero relief is exactly flat');
      seedDifference += Math.abs(landscape.heightAt(x, z) - changed.heightAt(x, z));
    }
    assert.ok(seedDifference > 100, `${terrainStyle}: seed changes landform`);

    for (let i = 0; i <= 360; i++) {
      const angle = i * Math.PI / 180;
      const coast = landscape.coastFactor(angle);
      assert.equal(coast, replay.coastFactor(angle));
      assert.ok(coast >= landscape.coastBounds.min - 1e-12 && coast <= landscape.coastBounds.max + 1e-12);
      assert.ok(Math.abs(coast - landscape.coastFactor(angle + Math.PI * 2)) < 1e-12, 'periodic coast');
      assert.ok(Math.abs(coast - landscape.coastFactor(angle + 1e-5)) < 5e-6, 'smooth coast');
    }

    // Frequency and detail parameters must influence geometry, not only colors.
    const fine = createLandscape(seed, { ...options, frequency: 0.009, octaves: 6, persistence: 0.7 });
    let parameterDifference = 0;
    for (let i = 0; i < 30; i++) {
      const x = (i - 15) * 23.7;
      const z = ((i % 7) - 3) * 53.1;
      parameterDifference += Math.abs(landscape.heightAt(x, z) - fine.heightAt(x, z));
    }
    assert.ok(parameterDifference > 1, 'noise parameters affect the height field');
  }

  assert.ok(results.mesas.flat > 0.4, 'mesas have broad, genuinely flat plateau tops');
  assert.ok(results.mesas.flat > results.hills.flat + 0.35, 'mesas differ geometrically from hills');
  assert.ok(results.ridges.roughness > results.hills.roughness * 3, 'ridged multifractal produces sharper chains');
  assert.ok(results.mesas.vegetation < results.hills.vegetation * 0.5, 'arid mesas have sparser vegetation');
  for (let i = 0; i < styles.length; i++) {
    for (let j = i + 1; j < styles.length; j++) {
      const a = results[styles[i]].heights;
      const b = results[styles[j]].heights;
      const difference = a.reduce((sum, y, k) => sum + Math.abs(y - b[k]), 0) / a.length;
      assert.ok(difference > 10, 'styles create distinct geometry for the same seed');
    }
  }
  metrics.push({ seed, mesaFlatPercent: (results.mesas.flat * 100).toFixed(1), ridgeToHillRoughness: (results.ridges.roughness / results.hills.roughness).toFixed(1) });
}

// The ring/crater relationship must survive changes in island footprint.
for (const footprintRadius of [250, 500, 900]) {
  const volcano = createLandscape('caldera-shape', { terrainStyle: 'caldera', footprintRadius });
  const radialMean = (radius) => {
    let sum = 0;
    for (let i = 0; i < 48; i++) {
      const a = i * Math.PI * 2 / 48;
      sum += volcano.heightAt(Math.cos(a) * radius, Math.sin(a) * radius);
    }
    return sum / 48;
  };
  const rim = Math.max(...[0.36, 0.4, 0.44, 0.48, 0.52].map((r) => radialMean(r * footprintRadius)));
  assert.ok(rim > radialMean(0) + 45, 'caldera has a depressed central crater');
  assert.ok(rim > radialMean(footprintRadius * 0.9) + 40, 'volcanic rim rises above outer slopes');
}

assert.throws(() => createLandscape('x', { terrainStyle: 'unknown' }), /Unsupported terrain style/);
assert.throws(() => createLandscape('x', { terrainStyle: 'constructor' }), /Unsupported terrain style/);
for (const options of [{ terrain: -1 }, { terrain: NaN }, { footprintRadius: 0 }, { footprintRadius: Infinity }]) {
  assert.throws(() => createLandscape('x', options), RangeError);
}
assert.throws(() => createLandscape('x', { frequency: 0 }), /noise parameters/);

console.log('Landscape checks passed: four deterministic profiles, flat relief, seeded variations, plateau flatness, ridge roughness, caldera geometry, vegetation, and periodic coast.');
console.table(metrics);
