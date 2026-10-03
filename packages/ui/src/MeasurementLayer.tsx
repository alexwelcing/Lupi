/**
 * <MeasurementLayer /> — the coordinate measurement (distance or angle)
 * between picked atoms: an amber line, a letter over each atom and the value.
 *
 * While display motion carries the measured atoms (a poke, Tug, Burst, Heat,
 * the arrival), the line's ends, the letters and the value label ride with
 * them (play/displayFollow; the text is steady, so Heat barely shakes it).
 * The value itself never changes: it is measured on the rest coordinates,
 * which are the source truth; the motion is illustrative. Captures see the
 * whole layer at rest.
 */
import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import type * as THREE from 'three';
import { Billboard, Line } from '@react-three/drei/webgpu';
import { LupiText } from './labels/LupiText';
import type { Frame } from '@atlas/core/types';
import type { MolecularMeasurement, ResolvedMolecularMeasurement } from './measurements';
import { measurementValueLabel, resolveMolecularMeasurement } from './measurements';
import { FollowAtom, useDisplayFollower } from './play/displayFollow';

// drei 11's Line forwards unknown props to its Line2NodeMaterial as well as
// the Line2 object, but its props type lists only the object's props.
const MEASUREMENT_LINE_MATERIAL = {
  transparent: true,
  opacity: 0.94,
  depthTest: false,
  toneMapped: false,
};

type Vec3 = [number, number, number];
type LineObject = ComponentRef<typeof Line>;

export function MeasurementLayer({
  frame,
  frameIndex,
  measurement,
  hiddenAtomTypes,
  playing = false,
}: {
  frame: Frame;
  frameIndex: number;
  measurement: MolecularMeasurement | null;
  hiddenAtomTypes?: ReadonlySet<number>;
  playing?: boolean;
}) {
  if (playing) return null;
  const resolved = resolveMolecularMeasurement(frame, frameIndex, measurement);
  if (!resolved || resolved.status !== 'ready') return null;
  if (resolved.atoms.some((atom) => hiddenAtomTypes?.has(frame.types[atom.index]))) return null;
  return <MeasurementShape frame={frame} resolved={resolved} />;
}

/**
 * Write the polyline through `rest` (+ `offsets`, when moving) into a drei
 * Line's segment buffer in place: segment s holds points s and s + 1. At rest
 * the floats are exactly the rest coordinates again.
 */
function writeLinePoints(line: LineObject | null, rest: Float64Array, offsets: Float64Array | null): void {
  const attribute = line?.geometry?.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute | undefined;
  if (!attribute || !attribute.isInterleavedBufferAttribute) return;
  const array = attribute.data.array as Float32Array;
  const count = rest.length / 3;
  if (array.length < (count - 1) * 6) return;
  for (let s = 0; s < count - 1; s += 1) {
    for (let end = 0; end < 2; end += 1) {
      const p = (s + end) * 3;
      const at = s * 6 + end * 3;
      array[at] = rest[p] + (offsets ? offsets[p] : 0);
      array[at + 1] = rest[p + 1] + (offsets ? offsets[p + 1] : 0);
      array[at + 2] = rest[p + 2] + (offsets ? offsets[p + 2] : 0);
    }
  }
  attribute.data.needsUpdate = true;
}

function valueLabelPosition(kind: ResolvedMolecularMeasurement['kind'], points: readonly Vec3[]): Vec3 {
  return kind === 'distance'
    ? midpoint(points[0], points[1])
    : angleLabelPosition(points[0], points[1], points[2]);
}

function MeasurementShape({ frame, resolved }: { frame: Frame; resolved: ResolvedMolecularMeasurement }) {
  const points = resolved.atoms.map((atom) => atom.position);
  const labelPosition = valueLabelPosition(resolved.kind, points);
  const span = points.slice(1).reduce(
    (largest, point, index) => Math.max(largest, pointDistance(points[index], point)),
    0,
  );
  const labelSize = Math.max(0.16, Math.min(1.2, span * 0.085));

  const rest = useMemo(() => Float64Array.from(resolved.atoms.flatMap((atom) => atom.position)), [resolved]);
  const lineRef = useRef<LineObject>(null);
  const valueRef = useRef<THREE.Group>(null);

  // The line moves out of its bounding sphere while it follows: never cull it.
  useEffect(() => {
    if (lineRef.current) lineRef.current.frustumCulled = false;
  });

  // The line's ends follow their atoms exactly.
  useDisplayFollower({
    mode: 'exact',
    points: () => rest,
    apply: (offsets) => writeLinePoints(lineRef.current, rest, offsets),
  });

  // The value label keeps its place between the (steadily) moving atoms.
  useDisplayFollower({
    mode: 'steady',
    points: () => rest,
    apply: (offsets) => {
      const group = valueRef.current;
      if (!group) return;
      if (!offsets) {
        group.position.set(0, 0, 0);
        return;
      }
      const moved = points.map((p, i): Vec3 => [p[0] + offsets[i * 3], p[1] + offsets[i * 3 + 1], p[2] + offsets[i * 3 + 2]]);
      const at = valueLabelPosition(resolved.kind, moved);
      group.position.set(at[0] - labelPosition[0], at[1] - labelPosition[1], at[2] - labelPosition[2]);
    },
  });

  return (
    <group name="lupi-coordinate-measurement">
      <Line
        ref={lineRef}
        points={points}
        color="#fbbf24"
        lineWidth={2.2}
        {...MEASUREMENT_LINE_MATERIAL}
      />
      {resolved.atoms.map((atom, index) => (
        <FollowAtom key={`${atom.id}-${index}`} frame={frame} atom={atom.index} steady>
          <Billboard position={[atom.position[0], atom.position[1] + labelSize * 1.3, atom.position[2]]}>
            <LupiText
              fontSize={labelSize * 0.7}
              color="#fbbf24"
              anchorX="center"
              anchorY="middle"
              outlineWidth={labelSize * 0.08}
              outlineColor="#111827"
              renderOrder={100}
            >
              {String.fromCharCode(65 + index)}
            </LupiText>
          </Billboard>
        </FollowAtom>
      ))}
      <group ref={valueRef}>
        <Billboard position={labelPosition}>
          <LupiText
            fontSize={labelSize}
            color="#fff7d6"
            anchorX="center"
            anchorY="middle"
            outlineWidth={labelSize * 0.1}
            outlineColor="#111827"
            renderOrder={101}
          >
            {measurementValueLabel(resolved)}
          </LupiText>
        </Billboard>
      </group>
    </group>
  );
}

function midpoint(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function angleLabelPosition(
  a: readonly [number, number, number],
  vertex: readonly [number, number, number],
  c: readonly [number, number, number],
): [number, number, number] {
  const aLength = Math.hypot(a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]);
  const cLength = Math.hypot(c[0] - vertex[0], c[1] - vertex[1], c[2] - vertex[2]);
  const scale = Math.max(0.35, Math.min(aLength, cLength) * 0.24);
  const aDirection = normalize([a[0] - vertex[0], a[1] - vertex[1], a[2] - vertex[2]]);
  const cDirection = normalize([c[0] - vertex[0], c[1] - vertex[1], c[2] - vertex[2]]);
  const bisector = normalize([
    aDirection[0] + cDirection[0],
    aDirection[1] + cDirection[1],
    aDirection[2] + cDirection[2],
  ]);
  return [
    vertex[0] + bisector[0] * scale,
    vertex[1] + bisector[1] * scale,
    vertex[2] + bisector[2] * scale,
  ];
}

function normalize(value: readonly number[]): [number, number, number] {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) return [0, 1, 0];
  return [value[0] / length, value[1] / length, value[2] / length];
}

function pointDistance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
