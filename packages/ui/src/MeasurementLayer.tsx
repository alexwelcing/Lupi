import { Billboard, Line, Text } from '@react-three/drei';
import type { Frame } from '@atlas/core/types';
import type { MolecularMeasurement } from './measurements';
import { measurementValueLabel, resolveMolecularMeasurement } from './measurements';

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

  const points = resolved.atoms.map((atom) => atom.position);
  const labelPosition = resolved.kind === 'distance'
    ? midpoint(points[0], points[1])
    : angleLabelPosition(points[0], points[1], points[2]);
  const span = points.slice(1).reduce(
    (largest, point, index) => Math.max(largest, pointDistance(points[index], point)),
    0,
  );
  const labelSize = Math.max(0.16, Math.min(1.2, span * 0.085));

  return (
    <group name="lupi-coordinate-measurement">
      <Line
        points={points}
        color="#fbbf24"
        lineWidth={2.2}
        transparent
        opacity={0.94}
        depthTest={false}
        toneMapped={false}
      />
      {resolved.atoms.map((atom, index) => (
        <Billboard
          key={`${atom.id}-${index}`}
          position={[atom.position[0], atom.position[1] + labelSize * 1.3, atom.position[2]]}
        >
          <Text
            fontSize={labelSize * 0.7}
            color="#fbbf24"
            anchorX="center"
            anchorY="middle"
            outlineWidth={labelSize * 0.08}
            outlineColor="#111827"
            renderOrder={100}
          >
            {String.fromCharCode(65 + index)}
          </Text>
        </Billboard>
      ))}
      <Billboard position={labelPosition}>
        <Text
          fontSize={labelSize}
          color="#fff7d6"
          anchorX="center"
          anchorY="middle"
          outlineWidth={labelSize * 0.1}
          outlineColor="#111827"
          renderOrder={101}
        >
          {measurementValueLabel(resolved)}
        </Text>
      </Billboard>
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
