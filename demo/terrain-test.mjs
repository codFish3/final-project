import assert from 'node:assert/strict';
import * as T from './vendor/three.module.js';
import { generate, PRESETS, groundHeight, distanceToTrack } from './track.js';
import { buildTerrainSurface } from './terrain.js';

const cases = [
  { style: 'shanghai', seed: '2401', ...PRESETS.shanghai },
  ...['hills', 'ridges', 'mesas', 'caldera'].map((terrainStyle) => ({
    style: 'spa', seed: '5660', ...PRESETS.spa, terrainStyle,
  })),
  {
    style: 'silverstone',
    seed: 'terrain-extreme',
    ...PRESETS.silverstone,
    elevation: 50,
    terrain: 65,
    frequency: 0.012,
    octaves: 6,
    persistence: 0.8,
    terrainStyle: 'ridges',
    width: 10,
    scale: 0.8,
  },
];

const profileOutputs = new Map();
let nominalRoad;

for (const settings of cases) {
  const track = generate(settings);
  const surface = buildTerrainSurface(track);
  const positions = surface.geometry.attributes.position;
  const indices = surface.geometry.index.array;
  assert.ok(surface.roadCellSize <= 2, 'road corridor has fine triangles');

  // Compare queries with actual rendered triangle planes, rather than the
  // continuous height function that produced the vertices.
  const stride = Math.max(1, Math.floor(indices.length / 3 / 1000));
  const a = new T.Vector3();
  const b = new T.Vector3();
  const c = new T.Vector3();
  for (let triangle = 0; triangle < indices.length / 3; triangle += stride) {
    a.fromBufferAttribute(positions, indices[triangle * 3]);
    b.fromBufferAttribute(positions, indices[triangle * 3 + 1]);
    c.fromBufferAttribute(positions, indices[triangle * 3 + 2]);
    const x = (a.x + b.x + c.x) / 3;
    const z = (a.z + b.z + c.z) / 3;
    const expectedHeight = (a.y + b.y + c.y) / 3;
    const sample = surface.sampleAt(x, z);
    assert.ok(Math.abs(sample.height - expectedHeight) < 1e-5, 'query matches rendered triangle');
    const expectedNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    assert.ok(sample.normal.distanceTo(expectedNormal) < 1e-6, 'query matches face normal');
    assert.ok(sample.normal.y > 0, 'upward finite face normal');
  }

  // Every internal edge must have two faces, including the transition from
  // subdivided cells to coarse cells. A lone internal edge means a T junction.
  const edges = new Map();
  for (let k = 0; k < indices.length; k += 3) {
    for (let side = 0; side < 3; side++) {
      const u = indices[k + side];
      const v = indices[k + (side + 1) % 3];
      const key = `${Math.min(u, v)},${Math.max(u, v)}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const bound = Math.fround(surface.radius);
  let borderVertices = 0;
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(positions.getX(i)) === bound || Math.abs(positions.getZ(i)) === bound) {
      assert.ok(positions.getY(i) < -2.7, 'square mesh border is completely below water');
      borderVertices++;
    }
  }
  assert.ok(borderVertices >= 4, 'mesh border was checked');
  for (const [key, faces] of edges) {
    assert.ok(faces === 1 || faces === 2, 'manifold triangle edges');
    if (faces === 1) {
      const [u, v] = key.split(',').map(Number);
      const onBorder =
        (Math.abs(positions.getX(u)) === bound && positions.getX(u) === positions.getX(v)) ||
        (Math.abs(positions.getZ(u)) === bound && positions.getZ(u) === positions.getZ(v));
      assert.ok(onBorder, 'no open internal seams between coarse and fine cells');
    }
  }

  // Interpolated terrain must remain under the road at its centre and edges.
  // It should also stay close to the intended road-aware height field.
  for (const frame of track.frames.filter((_, i) => i % 4 === 0)) {
    for (const offset of [-track.width / 2, 0, track.width / 2]) {
      const p = frame.p.clone().addScaledVector(frame.n, offset);
      assert.ok(surface.coastEdgeAt(p.x, p.z) < 0.86, 'road stays before coastal fade');
      const y = surface.heightAt(p.x, p.z);
      assert.ok(y < p.y + 0.02, 'terrain does not pierce the road');
      assert.ok(Math.abs(y - groundHeight(p.x, p.z, track)) < 0.16, 'fine corridor follows road');
    }
    for (const offset of [-track.width / 2 - 7, track.width / 2 + 7]) {
      const p = frame.p.clone().addScaledVector(frame.n, offset);
      assert.ok(surface.coastEdgeAt(p.x, p.z) < 0.86, 'protected shoulder stays inland');
    }
  }

  // A distant infield point must regain its full landscape profile. This checks
  // the field before triangulation, so coarse-cell approximation cannot hide an
  // over-wide road blend. All profiles use the identical road for comparison.
  const naturalHeights = [];
  const distance = track.width / 2 + 7 + 48;
  for (let j = 0; j <= 30; j++) {
    for (let i = 0; i <= 30; i++) {
      const x = ((i / 30) * 2 - 1) * surface.islandRadius * 0.82;
      const z = ((j / 30) * 2 - 1) * surface.islandRadius * 0.82;
      if (surface.coastEdgeAt(x, z) >= 0.82 || distanceToTrack({ x, z }, track) <= distance) {
        continue;
      }
      const natural = track.landscape.heightAt(x, z);
      assert.ok(Math.abs(groundHeight(x, z, track) - natural) < 1e-9,
        'distant terrain retains its unflattened landscape height');
      naturalHeights.push(natural);
    }
  }
  assert.ok(naturalHeights.length >= 20, 'checked a meaningful region beyond the road blend');
  if (settings.style === 'spa' && settings.seed === '5660') {
    const road = track.points.map((p) => p.toArray());
    if (nominalRoad) assert.deepEqual(road, nominalRoad, 'terrain style preserves the same road');
    nominalRoad = road;
    profileOutputs.set(settings.terrainStyle, naturalHeights);
  }
  console.log(
    `${settings.style}/${track.terrainStyle} ${settings.seed}: ${positions.count} vertices, ${indices.length / 3} triangles; exact height queries, normals, shared seams, road clearance, coast bounds and ${naturalHeights.length} natural-height samples passed.`
  );
  surface.geometry.dispose();
}

const profiles = [...profileOutputs];
for (let i = 0; i < profiles.length; i++) {
  for (let j = i + 1; j < profiles.length; j++) {
    const [nameA, heightsA] = profiles[i];
    const [nameB, heightsB] = profiles[j];
    assert.equal(heightsA.length, heightsB.length, 'profiles compare identical positions');
    const averageDifference = heightsA.reduce((sum, h, k) => sum + Math.abs(h - heightsB[k]), 0) /
      heightsA.length;
    assert.ok(averageDifference > 3, `${nameA}/${nameB} have measurably distinct natural relief`);
  }
}
console.log('All four terrain profiles preserve the same road while producing distinct natural relief.');
