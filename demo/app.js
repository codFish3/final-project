import * as T from './vendor/three.module.js';
import { generate, random, distanceToTrack, PRESETS } from './track.js';
import { buildTerrainSurface } from './terrain.js';
import { buildPipeline, STAGES } from './pipeline.js';
import { EXAMPLES, exampleSettings } from './examples.js';
const $ = (id) => document.getElementById(id);
const canvas = $('scene');
let renderer;
try {
  renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
} catch (e) {
  $('error').hidden = false;
  $('error').textContent = 'This demo needs a browser with WebGL enabled. ' + e.message;
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.setClearColor(0xbadbd5);
const scene = new T.Scene();
scene.fog = new T.Fog(0xbadbd5, 2200, 5000);
const camera = new T.PerspectiveCamera(39, 1, 0.3, 6000);
scene.add(new T.HemisphereLight(0xe8f4ff, 0x607c51, 2.5));
const sun = new T.DirectionalLight(0xffedce, 3.1);
sun.position.set(-400, 850, 300);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, {
  left: -850,
  right: 850,
  top: 850,
  bottom: -850,
  near: 1,
  far: 2400,
});
sun.shadow.normalBias = 0.15;
sun.shadow.bias = -0.00015;
scene.add(sun);
const water = new T.Mesh(
  new T.PlaneGeometry(16000, 16000),
  new T.MeshStandardMaterial({ color: 0x91c6bd, roughness: 0.8 })
);
water.rotation.x = -Math.PI / 2;
water.position.y = -2.7;
water.receiveShadow = true;
scene.add(water);
let world = new T.Group();
let guides = new T.Group();
let track;
let terrainSurface;
let pipeline;
let stage = 'complete';
let layers = {};
let car;
let mode = 'overview';
let progress = 0;
let paused = false;
let orbit = { angle: 0.67, elevation: 0.83, distance: 220 };
let drag = null;
let buildTime = 0;
scene.add(world);
const up = new T.Vector3(0, 1, 0);
const mat = (color, extra = {}) => new T.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

function mesh(geo, material, x = 0, y = 0, z = 0, parent = world) {
  const m = new T.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function box(w, h, d, material, p, rotation = 0) {
  const m = mesh(new T.BoxGeometry(w, h, d), material, ...p);
  m.rotation.y = rotation;
  return m;
}

function ribbon(a, b, height, material) {
  const v = [];
  const uv = [];
  const indices = [];
  const N = track.frames.length;
  for (let i = 0; i <= N; i++) {
    const f = track.frames[i % N];
    for (const offset of [a, b]) {
      const p = f.p.clone().addScaledVector(f.n, offset);
      v.push(p.x, p.y + height, p.z);
      uv.push(offset, (i * track.length) / N / 5);
    }
  }
  for (let i = 0; i < N; i++) {
    let k = i * 2;
    indices.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return mesh(g, material);
}

function curb(side) {
  const v = [];
  const colors = [];
  const idx = [];
  const N = track.frames.length;
  const red = new T.Color(0xe66e4a);
  const white = new T.Color(0xf4efdb);
  for (let i = 0; i < N; i++) {
    const color = Math.floor((i * track.length) / N / 2.2) % 2 ? white : red;
    for (const j of [i, i + 1]) {
      for (const off of [track.width / 2, track.width / 2 + 1]) {
        let p = track.frames[j % N].p.clone().addScaledVector(track.frames[j % N].n, side * off);
        v.push(p.x, p.y + 0.17, p.z);
        colors.push(color.r, color.g, color.b);
      }
    }
    let k = i * 4;
    idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(v, 3));
  g.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  mesh(g, mat(0xffffff, { vertexColors: true, side: T.DoubleSide }));
}

function buildIsland() {
  terrainSurface = buildTerrainSurface(track);
  const island = mesh(
    terrainSurface.geometry,
    mat(0xffffff, { vertexColors: true, side: T.DoubleSide })
  );
  // Dense, shallow terrain faces otherwise produce striped self-shadow artifacts.
  // Props still cast shadows onto the terrain, which keeps its normal lighting.
  island.castShadow = false;
  return terrainSurface.radius;
}

function buildVerge(side) {
  const vertices = [];
  const indices = [];
  const bands = 4;
  const count = track.frames.length;
  for (let i = 0; i <= count; i++) {
    const frame = track.frames[i % count];
    for (let j = 0; j <= bands; j++) {
      const t = j / bands;
      const p = frame.p.clone().addScaledVector(frame.n, side * (track.width / 2 + 2 + t * 5));
      const ground = terrainSurface.heightAt(p.x, p.z);
      const y = T.MathUtils.lerp(frame.p.y - 0.08, ground + 0.06, t);
      vertices.push(p.x, y, p.z);
    }
  }
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < bands; j++) {
      const k = i * (bands + 1) + j;
      indices.push(k, k + bands + 1, k + 1, k + 1, k + bands + 1, k + bands + 2);
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const verge = mesh(geometry, mat(track.landscape.palette.low, { side: T.DoubleSide }));
  // This thin cover should not cast a second shadow onto the terrain below it.
  verge.castShadow = false;
}

function buildProps(rng, radius) {
  const locations = [];
  const targetTrees = { hills: 520, ridges: 320, mesas: 110, caldera: 170 }[track.terrainStyle];
  let trials = 0;
  while (locations.length < targetTrees && trials++ < 12000) {
    const p = { x: (rng() * 2 - 1) * radius * 0.84, z: (rng() * 2 - 1) * radius * 0.84 };
    if (Math.hypot(p.x, p.z) > radius * 0.84 || distanceToTrack(p, track) < track.width / 2 + 13) {
      continue;
    }
    if (terrainSurface.normalAt(p.x, p.z).y < 0.88) {
      continue;
    }
    if (
      terrainSurface.coastEdgeAt(p.x, p.z) > 0.82 ||
      rng() > track.landscape.vegetationAt(p.x, p.z)
    ) {
      continue;
    }
    if (locations.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 10)) {
      continue;
    }
    locations.push(p);
  }
  // Minimum-distance rejection sampling prototype; full Bridson active-list sampling is future work.
  const trunks = new T.InstancedMesh(
    new T.CylinderGeometry(0.28, 0.4, 2, 6),
    mat(0x846443),
    locations.length
  );
  const leaves = new T.InstancedMesh(
    new T.ConeGeometry(2, 5, 7),
    mat(0xffffff, { flatShading: true }),
    locations.length
  );
  const rocks = new T.InstancedMesh(
    new T.DodecahedronGeometry(1.5, 0),
    mat(track.landscape.palette.rock, { flatShading: true }),
    Math.floor(locations.length / 4)
  );
  const dummy = new T.Object3D();
  const treeColor = new T.Color(track.landscape.palette.tree || 0x397c59);
  let rockIndex = 0;
  locations.forEach((p, i) => {
    const y = terrainSurface.heightAt(p.x, p.z);
    const size = track.terrainStyle === 'mesas' ? 1.2 : 2.2;
    const s = size + rng() * size;
    dummy.position.set(p.x, y + s - 0.1, p.z);
    dummy.scale.set(1, s, 1);
    dummy.rotation.set(0, rng() * 6, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.y = y + 3.5 * s - 0.1;
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);
    leaves.setColorAt(
      i,
      treeColor.clone().offsetHSL((rng() - 0.5) * 0.035, (rng() - 0.5) * 0.08, (rng() - 0.5) * 0.12)
    );
    if (i % 4 === 0 && rockIndex < rocks.count) {
      const x = p.x + 5;
      const z = p.z + 3;
      if (distanceToTrack({ x, z }, track) < track.width / 2 + s * 1.5 + 3) return;
      const normal = terrainSurface.normalAt(x, z);
      if (normal.y < 0.88) return;
      dummy.position.set(0, 0, 0);
      dummy.scale.set(s, s * 0.7, s);
      dummy.quaternion.setFromUnitVectors(up, normal);
      dummy.rotateY(rng() * Math.PI * 2);
      dummy.updateMatrix();
      // Rest the lower rock vertices against the rendered surface, with a small embed.
      const positions = rocks.geometry.getAttribute('position');
      const vertex = new T.Vector3();
      let support = -Infinity;
      for (let j = 0; j < positions.count; j++) {
        vertex.fromBufferAttribute(positions, j).applyMatrix4(dummy.matrix);
        support = Math.max(support, terrainSurface.heightAt(x + vertex.x, z + vertex.z) - vertex.y);
      }
      dummy.position.set(x, support - 0.25, z);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockIndex++, dummy.matrix);
    }
  });
  rocks.count = rockIndex;
  for (const m of [trunks, leaves, rocks]) {
    m.castShadow = true;
    m.receiveShadow = true;
    world.add(m);
  }
}

function buildBarriers() {
  const material = mat(0xe5e8dc);
  const post = mat(0x6e897b);
  const N = track.frames.length;
  for (const side of [-1, 1]) {
    ribbon(
      side * (track.width / 2 + 2.1),
      side * (track.width / 2 + 2.35),
      0.75,
      mat(0xd7e0cc, { side: T.DoubleSide })
    );
    const pts = track.frames.map((f) =>
      f.p
        .clone()
        .addScaledVector(f.n, side * (track.width / 2 + 2.2))
        .add(new T.Vector3(0, 0.85, 0))
    );
    pts.push(pts[0].clone());
    mesh(
      new T.TubeGeometry(new T.CatmullRomCurve3(pts.slice(0, -1), true), N, 0.16, 4, true),
      material
    );
    for (let i = 0; i < N; i += 7) {
      const p = pts[i];
      box(0.2, 0.9, 0.2, post, [p.x, p.y - 0.47, p.z]);
    }
  }
}

function buildStart() {
  const f = track.frames[track.start];
  const w = track.width;
  const heading = Math.atan2(f.t.x, f.t.z);
  const cream = mat(0xfff4dc);
  const dark = mat(0x24483b);
  for (const side of [-1, 1]) {
    const p = f.p.clone().addScaledVector(f.n, side * (w / 2 + 1.6));
    box(0.5, 5, 0.5, cream, [p.x, p.y + 2.5, p.z], heading);
  }
  const sign = box(w + 4, 0.95, 0.6, dark, [f.p.x, f.p.y + 5, f.p.z], heading);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#234d3b';
  ctx.fillRect(0, 0, 512, 96);
  ctx.font = 'bold 36px Arial';
  ctx.fillStyle = '#f6f0db';
  ctx.textAlign = 'center';
  ctx.fillText('ISLAND CIRCUIT', 256, 61);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const face = mesh(
    new T.PlaneGeometry(w + 3.4, 0.8),
    new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide })
  );
  face.position.copy(sign.position).addScaledVector(f.t, 0.32);
  face.rotation.y = heading;
  const tiles = 12;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < 2; j++) {
      const p = f.p
        .clone()
        .addScaledVector(f.n, ((i + 0.5) / tiles) * w - w / 2)
        .addScaledVector(f.t, (j - 0.5) * 0.55);
      const tile = box(
        w / tiles, 0.025, 0.55, (i + j) % 2 ? dark : cream,
        [p.x, p.y + 0.13, p.z]
      );
      const vertical = f.t.clone().cross(f.n).normalize();
      tile.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(f.n, vertical, f.t));
    }
  }
}

function buildCar() {
  car = new T.Group();
  world.add(car);
  const body = new T.Mesh(new T.BoxGeometry(1.6, 0.6, 3), mat(0xf18c4e));
  body.position.y = 0.65;
  body.castShadow = true;
  car.add(body);
  const cab = new T.Mesh(new T.BoxGeometry(1.3, 0.55, 1.2), mat(0x304f4a));
  cab.position.set(0, 1.15, -0.15);
  car.add(cab);
  const wheelG = new T.BoxGeometry(0.35, 0.55, 0.7);
  const wheelM = mat(0x263d38);
  for (const x of [-0.85, 0.85]) {
    for (const z of [-0.9, 0.9]) {
      const m = new T.Mesh(wheelG, wheelM);
      m.position.set(x, 0.4, z);
      car.add(m);
    }
  }
}

function disposeWorld() {
  const gs = new Set();
  const ms = new Set();
  const textures = new Set();
  world.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry) {
      gs.add(o.geometry);
    }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m) {
        ms.add(m);
        if (m.map) {
          textures.add(m.map);
        }
      }
    }
  });
  for (const x of [...gs, ...ms, ...textures]) {
    x.dispose();
  }
  scene.remove(world);
  world = new T.Group();
  scene.add(world);
}

function rebuild() {
  const begin = performance.now();
  try {
    const params = {
      seed: $('seed').value || '0',
      complexity: +$('complexity').value,
      width: +$('width').value,
      scale: +$('scale').value,
      style: $('style').value,
      infield: +$('infield').value,
      straight: +$('straight').value,
      elevation: +$('elevation').value,
      terrain: +$('terrain').value,
      terrainStyle: $('terrainStyle').value,
      frequency: +$('frequency').value,
      octaves: +$('octaves').value,
      persistence: +$('persistence').value,
    };
    track = generate(params);
    disposeWorld();
    const rng = random(params.seed + '-environment');
    layers = {};
    function capture(name, build) {
      const before = new Set(world.children);
      const result = build();
      layers[name] = world.children.filter((child) => !before.has(child));
      return result;
    }
    const r = capture('terrain', () => buildIsland());
    capture('road', () => {
      ribbon(-track.width / 2 - 2, -track.width / 2, -0.08, mat(0xe6d6ad, { side: T.DoubleSide }));
      ribbon(track.width / 2, track.width / 2 + 2, -0.08, mat(0xe6d6ad, { side: T.DoubleSide }));
      ribbon(-track.width / 2, track.width / 2, 0.08, mat(0x465954, { side: T.DoubleSide }));
      curb(-1);
      curb(1);
      buildBarriers();
      buildStart();
      buildVerge(-1);
      buildVerge(1);
    });
    capture('props', () => buildProps(rng, r));
    capture('car', () => buildCar());
    pipeline = buildPipeline(track);
    world.add(pipeline.group);
    guides = new T.Group();
    world.add(guides);
    const linePts = track.points.map((p) => p.clone().add(new T.Vector3(0, 0.3, 0)));
    linePts.push(linePts[0]);
    guides.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints(linePts),
        new T.LineBasicMaterial({ color: 0xffce54 })
      )
    );
    for (const p of track.controls) {
      mesh(
        new T.SphereGeometry(0.8, 8, 8),
        new T.MeshBasicMaterial({ color: 0xe15c31 }),
        p.x,
        p.y + 1,
        p.z,
        guides
      );
    }
    guides.visible = $('debug').checked;
    progress = track.start / track.points.length;
    orbit.distance = r * 2.9;
    orbit.elevation = 0.85;
    buildTime = performance.now() - begin;
    $('length').innerHTML = `${Math.round(track.length)}<em>m</em>`;
    $('radius').innerHTML = `${track.minRadius.toFixed(1)}<em>m</em>`;
    $('relief').innerHTML = `${track.relief.toFixed(1)}<em>m</em>`;
    $('time').innerHTML = `${Math.round(buildTime)}<em>ms</em>`;
    $('seed-label').textContent = track.seed;
    $('world-name').textContent = PRESETS[track.style].label;
    setStage($('stage').value);
    $('error').hidden = true;
    window.demoState = {
      seed: track.seed,
      attempts: track.attempts,
      fallback: track.fallback,
      length: track.length,
      buildTime,
      valid: true,
      relief: track.relief,
      style: track.style,
      maxGrade: track.maxGrade,
      terrainStyle: track.terrainStyle,
      rejectedAttempts: track.rejectedAttempts,
      stage,
    };
  } catch (e) {
    $('error').hidden = false;
    $('error').textContent = e.message;
    console.error(e);
  }
}
const target = new T.Vector3();

function setStage(value) {
  stage = value;
  pipeline.setStage(stage);
  const complete = stage === 'complete';
  for (const [name, objects] of Object.entries(layers)) {
    for (const object of objects) object.visible = complete || (stage === 'mesh' && name === 'road');
  }
  guides.visible = complete && $('debug').checked;
  $('stage-info').hidden = complete;
  let description = STAGES[stage];
  if (stage === 'validation') {
    const reasons = track.rejectedAttempts.reduce((counts, item) => {
      counts[item.reason] = (counts[item.reason] || 0) + 1;
      return counts;
    }, {});
    const rejected = Object.entries(reasons).map(([reason, count]) => `${count} ${reason}`).join(', ');
    description += ` Accepted candidate ${track.attempts}${track.fallback ? ' (fallback oval)' : ''}.`;
    description += ` Minimum radius ${track.minRadius.toFixed(1)} m; maximum grade ${(track.maxGrade * 100).toFixed(1)}%.`;
    if (rejected) description += ` Rejected: ${rejected}.`;
  }
  $('stage-info').textContent = description;
  if (!complete) setMode('plan');
  if (window.demoState) window.demoState.stage = stage;
}

let examplesReady = false;
$('show-examples').onclick = async () => {
  $('examples-dialog').showModal();
  if (examplesReady) return;
  const grid = $('examples-grid');
  grid.textContent = 'Generating examples…';
  await new Promise(requestAnimationFrame);
  try {
    const cards = EXAMPLES.map((example) => {
      const settings = exampleSettings(example, PRESETS);
      const output = generate(settings);
      const button = document.createElement('button');
      button.className = 'example-card';
      const preview = document.createElement('canvas');
      preview.width = 480;
      preview.height = 320;
      const ctx = preview.getContext('2d');
      const xs = output.points.map((p) => p.x);
      const zs = output.points.map((p) => p.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const fit = Math.min(420 / (maxX - minX), 260 / (maxZ - minZ));
      ctx.beginPath();
      output.points.forEach((p, i) => {
        const x = 240 + (p.x - (minX + maxX) / 2) * fit;
        const z = 160 + (p.z - (minZ + maxZ) / 2) * fit;
        if (i) {
          ctx.lineTo(x, z);
        } else {
          ctx.moveTo(x, z);
        }
      });
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 8;
      ctx.strokeStyle = '#315c49';
      ctx.stroke();
      const title = document.createElement('strong');
      title.textContent = `${PRESETS[example.style].label} · ${example.seed}`;
      const stats = document.createElement('span');
      stats.textContent = `${Math.round(output.length)} m · ${output.attempts} ${output.attempts === 1 ? 'candidate' : 'candidates'}${output.fallback ? ' · fallback' : ''}`;
      button.append(preview, title, stats);
      button.onclick = () => {
        for (const [id, value] of Object.entries(settings)) {
          if (!$(id)) continue;
          $(id).value = value;
          if ($(id + '-out')) $(id).dispatchEvent(new Event('input'));
        }
        $('stage').value = 'complete';
        setMode('overview');
        rebuild();
        $('examples-dialog').close();
      };
      return button;
    });
    grid.replaceChildren(...cards);
    examplesReady = true;
  } catch (error) {
    grid.textContent = `Could not generate examples: ${error.message}`;
  }
};
$('close-examples').onclick = () => $('examples-dialog').close();

function sample(u) {
  return track.curve.getPointAt(((u % 1) + 1) % 1);
}

function updateMap() {
  const c = $('map');
  const ctx = c.getContext('2d');
  const W = c.width;
  const H = c.height;
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...track.points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.z))));
  const scale = (H - 35) / max / 2;
  const xy = (p) => [W / 2 + p.x * scale, H / 2 + p.z * scale];
  ctx.beginPath();
  track.points.forEach((p, i) => (i ? ctx.lineTo(...xy(p)) : ctx.moveTo(...xy(p))));
  ctx.closePath();
  ctx.strokeStyle = '#dce6d6';
  ctx.lineWidth = 14;
  ctx.stroke();
  ctx.strokeStyle = '#567c65';
  ctx.lineWidth = 5;
  ctx.stroke();
  const start = xy(track.points[track.start]);
  ctx.fillStyle = '#567c65';
  ctx.fillRect(start[0] - 4, start[1] - 4, 8, 8);
  ctx.beginPath();
  ctx.arc(...xy(sample(progress)), 5, 0, Math.PI * 2);
  ctx.fillStyle = '#e48a48';
  ctx.fill();
  $('lap').textContent =
    Math.floor(((((progress - track.start / track.points.length) % 1) + 1) % 1) * 100) + '%';
}
let last = performance.now();
let mapTick = 0;

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (!track) {
    return;
  }
  if (!paused && stage === 'complete') {
    progress = (progress + (dt * 55) / track.length) % 1;
  }
  const pos = sample(progress);
  const ahead = sample(progress + 2 / track.length);
  car.position.copy(pos);
  car.rotation.y = Math.atan2(ahead.x - pos.x, ahead.z - pos.z);
  car.rotation.x = -Math.atan2(ahead.y - pos.y, Math.hypot(ahead.x - pos.x, ahead.z - pos.z));
  if (mode === 'follow') {
    const behind = sample(progress - 14 / track.length).add(new T.Vector3(0, 7, 0));
    camera.position.lerp(behind, 1 - Math.exp(-dt * 6));
    target.lerp(
      sample(progress + 13 / track.length).add(new T.Vector3(0, 1.3, 0)),
      1 - Math.exp(-dt * 7)
    );
  } else {
    const el = mode === 'plan' ? 1.565 : orbit.elevation;
    camera.position.set(
      Math.sin(orbit.angle) * Math.cos(el) * orbit.distance,
      Math.sin(el) * orbit.distance,
      Math.cos(orbit.angle) * Math.cos(el) * orbit.distance
    );
    target.set(0, stage === 'complete' ? 8 : 0, 0);
  }
  camera.lookAt(target);
  renderer.render(scene, camera);
  if (now - mapTick > 60) {
    updateMap();
    mapTick = now;
  }
}

function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

function setMode(v) {
  if (v === 'follow' && stage !== 'complete') {
    $('stage').value = 'complete';
    setStage('complete');
  }
  mode = v;
  $('overview').classList.toggle('active', v === 'overview');
  $('follow').classList.toggle('active', v === 'follow');
  $('plan').classList.toggle('active', v === 'plan');
  $('map-mode').textContent =
    v === 'overview' ? 'OVERVIEW' : v === 'plan' ? 'LAYOUT' : 'FOLLOW LAP';
  $('hint').textContent =
    v === 'overview' ? 'Drag to orbit · Scroll to zoom' : v === 'plan' ? 'Top-down circuit layout' : 'Following the circuit · 55 m/s';
}
$('overview').onclick = () => setMode('overview');
$('follow').onclick = () => setMode('follow');
$('plan').onclick = () => setMode('plan');
$('controls').onsubmit = (e) => {
  e.preventDefault();
  rebuild();
};
$('shuffle').onclick = () => {
  $('seed').value = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100000);
  rebuild();
};
for (const id of [
  'complexity',
  'width',
  'scale',
  'infield',
  'straight',
  'elevation',
  'terrain',
  'frequency',
  'octaves',
  'persistence',
]) {
  $(id).oninput = () => {
    $(id + '-out').textContent =
      id === 'frequency'
        ? Number($(id).value).toFixed(4)
        : id === 'persistence'
          ? Number($(id).value).toFixed(2)
          : id === 'width'
            ? $(id).value + ' m'
            : id === 'scale'
              ? Number($(id).value).toFixed(1) + '×'
              : $(id).value;
  };
}
$('style').onchange = () => {
  const preset = PRESETS[$('style').value];
  for (const [id, value] of Object.entries(preset)) {
    if (id === 'label') {
      continue;
    }
    $(id).value = value;
    $(id).dispatchEvent(new Event('input'));
  }
  rebuild();
};
$('terrainStyle').onchange = rebuild;
$('debug').onchange = () => {
  guides.visible = stage === 'complete' && $('debug').checked;
};
$('stage').onchange = () => setStage($('stage').value);
$('pause').onchange = () => {
  paused = $('pause').checked;
};
canvas.onpointerdown = (e) => {
  if (mode !== 'overview') {
    return;
  }
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) {
    return;
  }
  orbit.angle -= (e.clientX - drag.x) * 0.006;
  orbit.elevation = T.MathUtils.clamp(orbit.elevation + (e.clientY - drag.y) * 0.004, 0.25, 1.5);
  drag = { x: e.clientX, y: e.clientY };
};
canvas.onpointerup = canvas.onpointercancel = () => {
  drag = null;
};
canvas.addEventListener(
  'wheel',
  (e) => {
    if (mode === 'follow') {
      return;
    }
    e.preventDefault();
    orbit.distance = T.MathUtils.clamp(orbit.distance * Math.exp(e.deltaY * 0.001), 200, 3200);
  },
  { passive: false }
);
$('save').onclick = () => {
  renderer.render(scene, camera);
  const a = document.createElement('a');
  a.download = `island-circuit-${track.seed}-${track.terrainStyle}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
};
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) {
    e.preventDefault();
    $('pause').click();
  }
});
rebuild();
resize();
requestAnimationFrame(animate);
