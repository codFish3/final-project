import * as T from './vendor/three.module.js';

export const STAGES = {
  layout: 'The preset supplies an ordered loop of control points.',
  deformation: 'The seed stretches and bends the layout while preserving its corner order.',
  spline: 'A closed Catmull–Rom spline is sampled at approximately equal distances.',
  validation: 'The sampled loop is checked for crossings, clearance, turning radius and grade.',
  mesh: 'Local tangents and sideways vectors turn the curve into road and curb triangles.',
  complete: '',
};

export function buildPipeline(track) {
  const group = new T.Group();
  const parts = {};

  function line(name, points, color, opacity = 1) {
    const lifted = points.map((p) => p.clone().add(new T.Vector3(0, 1, 0)));
    lifted.push(lifted[0].clone());
    const object = new T.Line(
      new T.BufferGeometry().setFromPoints(lifted),
      new T.LineBasicMaterial({ color, transparent: opacity < 1, opacity })
    );
    group.add(object);
    parts[name] = object;
  }

  function dots(name, points, color) {
    const object = new T.InstancedMesh(
      new T.SphereGeometry(2.5, 8, 6),
      new T.MeshBasicMaterial({ color }),
      points.length
    );
    const matrix = new T.Matrix4();
    points.forEach((p, i) => object.setMatrixAt(i, matrix.makeTranslation(p.x, p.y + 1, p.z)));
    group.add(object);
    parts[name] = object;
  }

  line('base', track.layoutControls, 0x657f85, 0.65);
  dots('baseDots', track.layoutControls, 0x657f85);
  line('deformed', track.controls, 0xd4783b);
  dots('controlDots', track.controls, 0xd4783b);
  line('curve', track.points, 0x235e47);

  // Show the actual road triangles rather than a second approximation of the spline.
  const vertices = [];
  for (let i = 0; i < track.frames.length; i++) {
    const a = track.frames[i];
    const b = track.frames[(i + 1) % track.frames.length];
    const corners = [a, b].flatMap((f) => [-1, 1].map((s) =>
      f.p.clone().addScaledVector(f.n, s * track.width / 2).add(new T.Vector3(0, 0.2, 0))
    ));
    for (const [u, v] of [[0, 1], [0, 2], [1, 2], [1, 3]]) {
      vertices.push(...corners[u].toArray(), ...corners[v].toArray());
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  parts.wire = new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xf5c76b }));
  group.add(parts.wire);

  return {
    group,
    setStage(stage) {
      for (const object of Object.values(parts)) object.visible = false;
      const visible = {
        layout: ['base', 'baseDots'],
        deformation: ['base', 'deformed', 'controlDots'],
        spline: ['controlDots', 'curve'],
        validation: ['curve'],
        mesh: ['wire'],
        complete: [],
      }[stage] || [];
      for (const name of visible) parts[name].visible = true;
    },
  };
}
