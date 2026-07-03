/**
 * Per-atom vector fields — detection and derivation.
 *
 * Real research dumps carry per-atom vector triplets: velocities
 * (`vx vy vz`), forces (`fx fy fz`), dipoles (`mux muy muz`), and
 * compute/fix outputs in bracket form (`c_stress[1] c_stress[2]
 * c_stress[3]`). Parsers store each column as a named Float32Array in
 * `frame.properties`; this module recognizes triplets among those names
 * so the scene can draw them as glyphs and color atoms by magnitude.
 *
 * Shared by the scene (vector glyph renderer), the UI (field pickers,
 * legends), and export (baking glyphs into 3D assets).
 */

import type { Frame } from './types';

export type VectorFieldKind = 'velocity' | 'force' | 'dipole' | 'generic';

export interface VectorFieldSpec {
  /** Stable id — the shared column prefix, e.g. "v", "f", "c_stress". */
  id: string;
  /** Human label, e.g. "Velocity", "Force", "c_stress[1..3]". */
  label: string;
  kind: VectorFieldKind;
  /** The three property names, in x/y/z order. */
  components: [string, string, string];
  /** Property name under which the derived magnitude is cached. */
  magnitudeProperty: string;
}

/** Well-known LAMMPS per-atom vector triplets. */
const KNOWN_TRIPLETS: Array<{
  components: [string, string, string];
  id: string;
  label: string;
  kind: VectorFieldKind;
  magnitudeProperty: string;
}> = [
  { components: ['vx', 'vy', 'vz'], id: 'v', label: 'Velocity', kind: 'velocity', magnitudeProperty: '|v|' },
  { components: ['fx', 'fy', 'fz'], id: 'f', label: 'Force', kind: 'force', magnitudeProperty: '|F|' },
  { components: ['mux', 'muy', 'muz'], id: 'mu', label: 'Dipole', kind: 'dipole', magnitudeProperty: '|mu|' },
  // Angular momentum / velocity variants LAMMPS emits for finite-size particles.
  { components: ['omegax', 'omegay', 'omegaz'], id: 'omega', label: 'Angular velocity', kind: 'generic', magnitudeProperty: '|omega|' },
];

/**
 * Detect vector fields available among per-atom property names.
 * Recognizes the known triplets plus two generic shapes:
 *   suffix triplets  `<base>x <base>y <base>z`  (base non-empty)
 *   bracket triplets `<base>[1] <base>[2] <base>[3]` (compute/fix outputs)
 */
export function detectVectorFields(propertyNames: Iterable<string>): VectorFieldSpec[] {
  const names = new Set(propertyNames);
  const fields: VectorFieldSpec[] = [];
  const claimed = new Set<string>();

  for (const t of KNOWN_TRIPLETS) {
    if (t.components.every((c) => names.has(c))) {
      fields.push({ ...t });
      t.components.forEach((c) => claimed.add(c));
    }
  }

  // Generic suffix triplets (skip anything already claimed above).
  const bases = new Set<string>();
  for (const n of names) {
    if (n.length > 1 && (n.endsWith('x') || n.endsWith('y') || n.endsWith('z'))) {
      bases.add(n.slice(0, -1));
    }
  }
  for (const base of bases) {
    const comps: [string, string, string] = [`${base}x`, `${base}y`, `${base}z`];
    if (!comps.every((c) => names.has(c) && !claimed.has(c))) continue;
    fields.push({
      id: base,
      label: `${base} (vector)`,
      kind: 'generic',
      components: comps,
      magnitudeProperty: `|${base}|`,
    });
    comps.forEach((c) => claimed.add(c));
  }

  // Bracket triplets from computes/fixes: c_foo[1] c_foo[2] c_foo[3].
  const bracketBases = new Set<string>();
  for (const n of names) {
    const m = n.match(/^(.+)\[1\]$/);
    if (m) bracketBases.add(m[1]);
  }
  for (const base of bracketBases) {
    const comps: [string, string, string] = [`${base}[1]`, `${base}[2]`, `${base}[3]`];
    if (!comps.every((c) => names.has(c) && !claimed.has(c))) continue;
    // Only treat 3-component outputs as vectors — a 4th component means
    // it's something else (per-atom stress has 6, for example).
    if (names.has(`${base}[4]`)) continue;
    fields.push({
      id: base,
      label: `${base}[1..3]`,
      kind: 'generic',
      components: comps,
      magnitudeProperty: `|${base}|`,
    });
    comps.forEach((c) => claimed.add(c));
  }

  return fields;
}

/** Detect vector fields on a frame (convenience overload). */
export function detectFrameVectorFields(frame: Frame): VectorFieldSpec[] {
  if (!frame.properties || frame.properties.size === 0) return [];
  return detectVectorFields(frame.properties.keys());
}

/**
 * Get a field's three component arrays from a frame, or null when any
 * component is missing (e.g. a trajectory whose later frames dropped a
 * column).
 */
export function getVectorComponents(
  frame: Frame,
  spec: VectorFieldSpec,
): [Float32Array, Float32Array, Float32Array] | null {
  const p = frame.properties;
  if (!p) return null;
  const x = p.get(spec.components[0]);
  const y = p.get(spec.components[1]);
  const z = p.get(spec.components[2]);
  if (!x || !y || !z) return null;
  return [x, y, z];
}

/**
 * Compute (and cache on the frame) the per-atom magnitude of a vector
 * field. The cached array lands in `frame.properties` under
 * `spec.magnitudeProperty`, which makes it available to everything that
 * consumes per-atom scalars — property coloring, emission, legends —
 * with zero extra plumbing.
 */
export function ensureVectorMagnitude(frame: Frame, spec: VectorFieldSpec): Float32Array | null {
  const existing = frame.properties?.get(spec.magnitudeProperty);
  if (existing) return existing;
  const comps = getVectorComponents(frame, spec);
  if (!comps) return null;
  const [x, y, z] = comps;
  const n = Math.min(x.length, y.length, z.length);
  const mag = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mag[i] = Math.hypot(x[i], y[i], z[i]);
  }
  if (!frame.properties) frame.properties = new Map();
  frame.properties.set(spec.magnitudeProperty, mag);
  return mag;
}

/**
 * A robust glyph auto-scale: returns the magnitude at the given
 * percentile (default p95) so outliers don't flatten every other arrow.
 * O(n) via a small histogram — magnitudes are non-negative.
 */
export function magnitudePercentile(mag: Float32Array, percentile = 0.95): number {
  const n = mag.length;
  if (n === 0) return 0;
  let max = 0;
  for (let i = 0; i < n; i++) if (mag[i] > max) max = mag[i];
  if (max <= 0) return 0;
  const BINS = 512;
  const hist = new Uint32Array(BINS);
  const scale = (BINS - 1) / max;
  for (let i = 0; i < n; i++) hist[(mag[i] * scale) | 0]++;
  const target = percentile * n;
  let acc = 0;
  for (let b = 0; b < BINS; b++) {
    acc += hist[b];
    if (acc >= target) return (b + 1) / scale;
  }
  return max;
}
