import * as T from './vendor/three.module.js';
import { groundHeight, nearestTrack } from './track.js';

// Refine the road corridor while retaining a cheaper mesh at the coast.
// Coarse cells split their shared edges to match a refined neighbour exactly.
export function buildTerrainSurface(track) {
  const footprint = Math.max(...track.points.map((p) => Math.hypot(p.x, p.z)));
  // Keep the road inland at deep bays, and include the longest headlands in the mesh.
  const islandRadius = (footprint + 25) / (0.86 * track.landscape.coastBounds.min);
  const radius = islandRadius * Math.max(1.06, track.landscape.coastBounds.max * 0.96);
  const count = 128;
  const cellSize = (radius * 2) / count;
  const subdivisions = Math.max(2, Math.ceil(cellSize / 2));
  const latticeSize = count * subdivisions * 2;
  const refined = new Uint8Array(count * count);
  const ranges = new Uint32Array(count * count * 2);
  const vertices = new Map();
  const positions = [];
  const coastEdges = [];
  const colors = [];
  const indices = [];
  const palette = track.landscape.palette;
  const green = new T.Color(palette.low);
  const high = new T.Color(palette.high);
  const sand = new T.Color(palette.sand);
  const rock = new T.Color(palette.rock);

  function coastEdgeAt(x, z) {
    const shape = track.landscape.coastFactor(Math.atan2(z, x));
    return Math.hypot(x, z) / (islandRadius * shape);
  }

  function isRefined(i, j) {
    return i >= 0 && j >= 0 && i < count && j < count && refined[j * count + i];
  }

  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const x = -radius + (i + 0.5) * cellSize;
      const z = -radius + (j + 0.5) * cellSize;
      refined[j * count + i] =
        nearestTrack({ x, z }, track).distance < track.width / 2 + 24 + cellSize * Math.SQRT1_2;
    }
  }

  function vertex(i, j) {
    i = Math.round(i);
    j = Math.round(j);
    const key = j * (latticeSize + 1) + i;
    if (vertices.has(key)) {
      return vertices.get(key);
    }
    const x = Math.fround(-radius + (i / latticeSize) * radius * 2);
    const z = Math.fround(-radius + (j / latticeSize) * radius * 2);
    const edge = coastEdgeAt(x, z);
    let y = edge > 0.94 ? -3 - (edge - 0.94) * 110 : groundHeight(x, z, track);
    if (edge > 0.86 && edge <= 0.94) {
      y = T.MathUtils.lerp(y, -3, T.MathUtils.smoothstep(edge, 0.86, 0.94));
    }
    const color = green
      .clone()
      .lerp(high, T.MathUtils.smoothstep(y, 10, Math.max(35, track.terrain * 2.2)))
      .lerp(sand, T.MathUtils.smoothstep(edge, 0.85, 0.94));
    // Coordinate-based shading remains stable when mesh resolution changes.
    color.multiplyScalar(0.97 + 0.03 * Math.sin(x * 0.43 + Math.cos(z * 0.37)));
    const index = positions.length / 3;
    positions.push(x, Math.fround(y), z);
    coastEdges.push(edge);
    colors.push(color.r, color.g, color.b);
    vertices.set(key, index);
    return index;
  }

  for (let j = 0; j < count; j++) {
    for (let i = 0; i < count; i++) {
      const offset = (j * count + i) * 2;
      ranges[offset] = indices.length;
      const x = i * subdivisions * 2;
      const z = j * subdivisions * 2;
      if (isRefined(i, j)) {
        for (let v = 0; v < subdivisions; v++) {
          for (let u = 0; u < subdivisions; u++) {
            const a = vertex(x + u * 2, z + v * 2);
            const b = vertex(x + u * 2 + 2, z + v * 2);
            const c = vertex(x + u * 2, z + v * 2 + 2);
            const d = vertex(x + u * 2 + 2, z + v * 2 + 2);
            indices.push(a, c, b, b, c, d);
          }
        }
      } else {
        const border = [];
        const sides = [
          [0, 0, 1, 0, isRefined(i, j - 1)],
          [1, 0, 0, 1, isRefined(i + 1, j)],
          [1, 1, -1, 0, isRefined(i, j + 1)],
          [0, 1, 0, -1, isRefined(i - 1, j)],
        ];
        for (const [ox, oz, dx, dz, split] of sides) {
          const steps = split ? subdivisions : 1;
          for (let k = 0; k < steps; k++) {
            border.push(
              vertex(
                x + (ox + (dx * k) / steps) * subdivisions * 2,
                z + (oz + (dz * k) / steps) * subdivisions * 2
              )
            );
          }
        }
        const center = vertex(x + subdivisions, z + subdivisions);
        for (let k = 0; k < border.length; k++) {
          indices.push(center, border[(k + 1) % border.length], border[k]);
        }
      }
      ranges[offset + 1] = indices.length;
    }
  }

  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Color exposed steep faces as rock while retaining sand along the coast.
  const normals = geometry.getAttribute('normal');
  const colorAttribute = geometry.getAttribute('color');
  const shaded = new T.Color();
  for (let i = 0; i < normals.count; i++) {
    const exposure = T.MathUtils.smoothstep(1 - normals.getY(i), 0.08, 0.5);
    const inland = 1 - T.MathUtils.smoothstep(coastEdges[i], 0.83, 0.93);
    shaded.fromBufferAttribute(colorAttribute, i).lerp(rock, exposure * inland * 0.9);
    colorAttribute.setXYZ(i, shaded.r, shaded.g, shaded.b);
  }
  const data = geometry.attributes.position.array;
  const triangles = geometry.index.array;

  function sampleAt(x, z) {
    // Only props inside the island use this query; clamp makes edge queries safe.
    const bound = Math.fround(radius);
    x = T.MathUtils.clamp(x, -bound, bound);
    z = T.MathUtils.clamp(z, -bound, bound);
    const i = T.MathUtils.clamp(Math.floor((x + radius) / cellSize), 0, count - 1);
    const j = T.MathUtils.clamp(Math.floor((z + radius) / cellSize), 0, count - 1);
    const range = (j * count + i) * 2;
    for (let k = ranges[range]; k < ranges[range + 1]; k += 3) {
      const a = triangles[k] * 3;
      const b = triangles[k + 1] * 3;
      const c = triangles[k + 2] * 3;
      const bx = data[b] - data[a];
      const bz = data[b + 2] - data[a + 2];
      const cx = data[c] - data[a];
      const cz = data[c + 2] - data[a + 2];
      const determinant = bx * cz - bz * cx;
      const u = ((x - data[a]) * cz - (z - data[a + 2]) * cx) / determinant;
      const v = (bx * (z - data[a + 2]) - bz * (x - data[a])) / determinant;
      if (u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001) {
        const by = data[b + 1] - data[a + 1];
        const cy = data[c + 1] - data[a + 1];
        const normal = new T.Vector3(
          by * cz - bz * cy,
          bz * cx - bx * cz,
          bx * cy - by * cx
        ).normalize();
        return { height: data[a + 1] + u * by + v * cy, normal };
      }
    }
    throw new Error('Terrain query fell outside the mesh cell.');
  }

  return {
    geometry,
    radius,
    islandRadius,
    coastEdgeAt,
    sampleAt,
    heightAt: (x, z) => sampleAt(x, z).height,
    normalAt: (x, z) => sampleAt(x, z).normal,
    roadCellSize: cellSize / subdivisions,
  };
}
