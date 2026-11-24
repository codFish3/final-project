import assert from 'node:assert/strict';
import * as T from './vendor/three.module.js';
import { generate, validate, groundHeight, PRESETS } from './track.js';
import { createGradientNoise, createTerrainNoise } from './noise.js';
const a = generate({ seed: '2401' });
const b = generate({ seed: '2401' });
const c = generate({ seed: 'other' });
assert.deepEqual(
  a.points.map((p) => p.toArray()),
  b.points.map((p) => p.toArray())
);
assert.notDeepEqual(
  a.points.map((p) => p.toArray()),
  c.points.map((p) => p.toArray())
);
const signatures = new Set();
const seedShapes = new Map();

// Remove translation and uniform scale so enlargement alone cannot pass as variety.
function normalizedLayout(track) {
  const cx = track.controls.reduce((sum, p) => sum + p.x, 0) / track.controls.length;
  const cz = track.controls.reduce((sum, p) => sum + p.z, 0) / track.controls.length;
  const radius = Math.sqrt(
    track.controls.reduce((sum, p) => sum + (p.x - cx) ** 2 + (p.z - cz) ** 2, 0) /
      track.controls.length
  );
  return track.controls.map((p) => [(p.x - cx) / radius, (p.z - cz) / radius]);
}

function layoutDifference(a, b) {
  return Math.sqrt(
    a.reduce((sum, p, i) => sum + (p[0] - b[i][0]) ** 2 + (p[1] - b[i][1]) ** 2, 0) /
      a.length
  );
}
let fallbacks = 0;
let total = 0;
for (const style of Object.keys(PRESETS)) {
  for (const settings of [
    { ...PRESETS[style] },
    { complexity: 1, width: 5, scale: 1.4, infield: 35, straight: 15, elevation: 0, terrain: 0 },
    {
      complexity: 10,
      width: 10,
      scale: 0.8,
      infield: 100,
      straight: 100,
      elevation: 50,
      terrain: 65,
    },
  ]) {
    for (let i = 0; i < 12; i++) {
      const t = generate({ ...settings, style, seed: String(i) });
      assert.ok(
        validate(
          t.points.map((p) => new T.Vector3(p.x, 0, p.z)),
          t.width
        ).valid
      );
      assert.ok(t.curve.getPoint(0).distanceTo(t.curve.getPoint(1)) < 1e-7);
      assert.ok(t.maxGrade < 0.145, `grade ${t.maxGrade}`);
      assert.ok(Math.min(...t.points.map((p) => p.y)) > 7.9, 'road above water');
      if (settings.elevation === 0) {
        assert.ok(t.relief < 1e-8, 'flat-road control');
      } else {
        assert.ok(t.relief > 0, 'elevation control');
      }
      for (const p of t.points.filter((_, j) => j % 40 === 0)) {
        assert.ok(
          Math.abs(groundHeight(p.x, p.z, t) - (p.y - 0.3)) < 1e-5,
          'road-ground alignment'
        );
      }
      if (!t.fallback) {
        assert.ok(t.controls.length >= 20, 'complexity preserved');
      }
      assert.equal(t.rejectedAttempts.length, t.attempts - 1, 'retry history matches candidate');
      assert.equal(t.layoutControls.length, t.controls.length, 'base layout available for stages');
      if (settings.complexity === PRESETS[style].complexity && i < 6) {
        assert.ok(!t.fallback, 'preset seed variation must use accepted layouts');
        if (!seedShapes.has(style)) seedShapes.set(style, []);
        seedShapes.get(style).push(normalizedLayout(t));
        if (i === 0) {
          const replay = generate({ ...settings, style, seed: String(i) });
          assert.deepEqual(t.controls, replay.controls, 'same preset/seed reproduces controls');
          assert.deepEqual(t.rejectedAttempts, replay.rejectedAttempts, 'retries reproduce');
        }
      }
      fallbacks += Number(t.fallback);
      total++;
      if (i === 0 && settings.elevation !== 0) {
        signatures.add(t.points.map((p) => p.x.toFixed(1)).join(','));
      }
    }
  }
}
assert.ok(signatures.size >= 3, 'different preset layouts');
for (const [style, shapes] of seedShapes) {
  const differences = [];
  for (let i = 0; i < shapes.length; i++) {
    for (let j = i + 1; j < shapes.length; j++) {
      differences.push(layoutDifference(shapes[i], shapes[j]));
    }
  }
  differences.sort((a, b) => a - b);
  const median = differences[Math.floor(differences.length / 2)];
  assert.ok(median > 0.06, `${style}: same-style normalized seed difference ${median}`);
  console.log(`${style}: median normalized seed difference ${(median * 100).toFixed(1)}%.`);
}
assert.notDeepEqual(
  generate({ seed: 'x', infield: 65 }).points,
  generate({ seed: 'x', infield: 95 }).points
);
assert.notDeepEqual(
  generate({ seed: 'x', straight: 25 }).points,
  generate({ seed: 'x', straight: 95 }).points
);
console.log(
  `${total} seed/preset/parameter checks passed; ${fallbacks} explicit fallback layouts. Determinism, preset variation, closure, grade limits, elevation controls, and road-ground alignment passed.`
);

const field = createTerrainNoise('noise-test');
const clone = createTerrainNoise('noise-test');
const other = createTerrainNoise('another');
let variation = 0;
for (let i = 0; i < 200; i++) {
  const x = (i - 80) * 7.17;
  const z = ((i % 37) - 15) * 19.31;
  const n = field(x, z);
  assert.equal(n, clone(x, z));
  assert.ok(Number.isFinite(n) && Math.abs(n) <= 1);
  variation += Math.abs(n - other(x, z));
  assert.ok(Math.abs(n - field(x + 1e-5, z)) < 1e-4, 'continuous noise');
}
assert.ok(variation > 1, 'seed changes field');
const gradient = createGradientNoise('boundary');
assert.ok(
  Math.abs(gradient(-1 - 1e-7, 0.41) - gradient(-1 + 1e-7, 0.41)) < 1e-5,
  'lattice boundary continuity'
);
for (const settings of [
  { frequency: 0.001, octaves: 1, persistence: 0.25 },
  { frequency: 0.012, octaves: 6, persistence: 0.8 },
]) {
  const f = createTerrainNoise('noise-test', settings);
  assert.notEqual(f(53.2, -19.5), field(53.2, -19.5));
  for (const style of Object.keys(PRESETS)) {
    const t = generate({ seed: 'noise-extreme', style, elevation: 50, terrain: 65, ...settings });
    assert.ok(t.maxGrade <= 0.14 + 1e-6);
    assert.ok(t.points.every((p) => Number.isFinite(p.y)));
  }
}
console.log(
  'Noise checks passed: seeded reproducibility, bounds, continuity, parameter effects, and 6 elevated preset/parameter extremes.'
);
