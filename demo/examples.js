// Three seeds share one preset to make seed-driven shape changes easy to compare.
export const EXAMPLES = [
  { seed: '2401', style: 'shanghai' },
  { seed: '5660', style: 'shanghai' },
  { seed: '1031', style: 'shanghai' },
  { seed: '2026', style: 'spa' },
  { seed: '1107', style: 'silverstone' },
];

export function exampleSettings(example, presets) {
  return {
    ...presets[example.style],
    ...example,
    width: 7,
    scale: 1,
    frequency: 0.004,
    octaves: 4,
    persistence: 0.5,
    terrainStyle: 'hills',
  };
}
