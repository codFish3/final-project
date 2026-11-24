# Island Circuit demo

The full MS2 entry point is `index.html`. Double-click `start.command` in the parent folder to launch it. The root README records current progress, scope changes, validation, and three output images under Milestone #3.

From this folder, run `python3 -m http.server 5660 --bind 127.0.0.1`, then open http://127.0.0.1:5660 in a WebGL-enabled browser. No installation or CDN is required. Three.js 0.180.0 is vendored with its MIT license.

Open [the basic prototype](http://127.0.0.1:5660/prototype.html) to inspect the generated track, control points, and gray terrain. Enter a seed, choose a layout, and click **Generate**. Use **Show 3D terrain** to switch from the top-down view.

## Circuit and terrain controls

Choose a circuit character preset, then adjust parameters and select **Generate circuit**. Choosing a preset applies its suggested parameter values immediately; seed, width, and scale remain under your control. Shuffle generates a fresh seed immediately.

| Control | Effect |
| --- | --- |
| Circuit character | Three distinct macro layouts inspired by technical sequences, flowing corners, or fast esses. These are original stylized layouts, not traces or replicas of Shanghai, Spa, or Silverstone. |
| Infield depth | Changes the inward folds and spacing of the technical sections. |
| Straight stretch | Stretches the longitudinal footprint, extending the major straights. |
| Curve complexity | Changes alternating control-point offsets, strengthening or weakening local direction changes. The preset determines the main corner sequence; this is not an exact corner-count control. |
| Road width | Sets road width in scene meters. |
| Island scale | Sets the initial circuit footprint. Validation can enlarge the footprint on later attempts to preserve clearance and turn radius. |
| Track elevation | Controls the strength of the seeded height field sampled by the track. A grade limiter reduces excessive elevation. Read the actual height range from the metric panel. |
| Noise frequency | Base noise frequency: low values give broad hills; high values give smaller features. |
| Noise octaves | Number of layered noise scales (1–6). |
| Noise roughness | Persistence: the amplitude retained by each higher-frequency octave. |
| Terrain relief | Controls surrounding hills independently of the track. A road-distance blend carves a corridor that follows the track elevation. |
| Terrain character | Rolling hills, warped mountain ridges, flat-top terraced mesas, or a footprint-scaled volcanic ring/crater. Changes landform geometry, materials and vegetation while keeping the road unchanged. Selecting a character regenerates immediately. |

**Overview** supports dragging to orbit and scrolling to zoom. **Layout** shows the circuit from above and supports scrolling to zoom. **Follow lap** follows the automatically moving orange car, including elevation and pitch. Pause freezes lap progression. Guides show control points and the sampled centerline. Save view exports the 3D canvas as a PNG.

**Generation stage** switches between the base polygon, seeded deformation, sampled spline, validation, road triangles and the complete scene. Intermediate stages use the layout camera and pause lap progression. Validation shows rejection reasons and the accepted candidate's radius/grade. Switching to Follow lap restores the complete scene.

**View five examples** opens five generated layouts. The first three share the Shanghai preset and differ only in seed. Selecting a card applies all of its parameters and generates the corresponding complete scene. Current submission screenshots are in `docs/ms2/` relative to the repository root.

## Generation

A chosen macro control polygon is deformed by seed, inward-fold strength, longitudinal stretch, and alternating local offsets. A closed centripetal spline is sampled at approximately equal arc distances. Sampled horizontal intersections, nonlocal corridor clearance, and local turning radii are checked. Later attempts reduce jitter and can enlarge the layout; retry exhaustion uses an explicitly labeled oval fallback.

A seeded 2D gradient-noise field (Perlin-style quintic interpolation) is combined into normalized fractal Brownian motion (fBm). Octaves double frequency and multiply amplitude by persistence. Successive layers use separate hashed seeds, coordinate offsets, and rotations. This field supplies track heights; separate seeded landscape fields construct the surrounding natural terrain. Elevation is iteratively reduced if the sampled grade exceeds 14%. The final elevated curve is resampled and its horizontal projection validated again. Road, curbs, barriers, the start/finish structure, the car, and the camera share those elevated frames. The lowest road point is raised to 8 scene meters to remain above water. Terrain uses four seeded landform constructions: domain-warped hills, a ridged multifractal, smoothly terraced mesas, and an eccentric volcanic ring/crater. Each profile has separate rock/soil colors and vegetation rules. The road corridor uses a bounded 28–48 m transition to preserve the natural infield terrain. Coast harmonics vary by seed; coastline padding keeps the road inland. Its adaptive mesh has cells no larger than 2 m near the road, with shared edges at coarse/fine transitions. Props query the actual rendered triangles using barycentric interpolation. Trees have correctly scaled root positions; rocks use transformed vertex support heights and slope-aware orientation.

## Validation

Run `npm test` from this folder, or run `node demo/test.mjs`, `node demo/landscape-test.mjs` and `node demo/terrain-test.mjs` from the repository root. Generator checks cover 108 seed/preset/parameter combinations, including supported parameter extremes: deterministic regeneration, normalized shape differences between seeds, closure, horizontal validity, sampled grade limits, flat/elevated settings, road-above-water constraints, and road/ground height alignment. Fallback frequency is printed rather than counted as a successful complex random layout. Terrain checks compare queries to actual rendered triangle planes/normals, check interior mesh seams, and sample road clearance in six configurations covering every profile and an extreme. They also check distant natural terrain, coastline safety and an unchanged road across terrain styles. Landscape checks verify repeatability, plateau flatness, ridge roughness, caldera structure, vegetation and periodic coastline.

## Prototype limits

This is a JavaScript ES-module prototype of the proposed TypeScript architecture. The macro corner sequences are authored starting structures; seed changes deform them instead of inventing arbitrary new topology. Layout validation is numerical, and a full ribbon-triangle overlap validator remains future work. Tree/rock placement uses minimum-distance rejection sampling rather than Bridson's active-list algorithm. Terrain now uses seeded gradient-noise fBm; very fine features are limited by terrain mesh resolution. Finite terrain mesh resolution can produce small artifacts at sharp cuttings. There is no manual driving, vehicle physics, banking, bridges, or AI. The car follows the centerline kinematically at 55 scene meters per second.

Noise changes apply after selecting Generate circuit. The noise settings remain unchanged when switching circuit-character presets.

The lap lengths, heights, and preset labels describe generated demo geometry, not the corresponding real circuits. Generation timing includes scene construction. The submitted design document has not been modified by the demo.

## Inspiration

- [Formula 1: Shanghai circuit guide](https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-the-shanghai-international.1b0f0ghbsPMRsHJoHTt6eB.1b0f0ghbsPMRsHJoHTt6eB)
- [Formula 1: Silverstone circuit guide](https://www.formula1.com/en/latest/article/circuit-guide-everything-you-need-to-know-about-silverstone-2026.5Sl0O8g393enBWVIkjRzOr)
- [Formula 1: Circuit elevation changes](https://www.formula1.com/en/latest/article/highs-and-lows-which-f1-track-has-the-most-elevation-changes-.7I9JEcBw3R2AqXbnJ6hyvc.7I9JEcBw3R2AqXbnJ6hyvc)
