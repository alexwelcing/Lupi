/**
 * <SelectionMarkers /> - subtle selected and hover feedback for atoms.
 *
 * Camera-facing rings (drei `Billboard`) with plain basic materials, which
 * WebGPURenderer draws through their node equivalents on both backends. A
 * newly selected ring pulses a few times and comes to rest (Quiet Idle: a
 * still view draws nothing); Gentle halves the pulse and Still skips it.
 *
 * Each ring rides its atom's display offset (play/displayFollow): through
 * the arrival, a poke ripple, Tug, Burst and Heat it stays on the atom, and
 * it is back exactly at rest when the motion ends. Captures see it at rest.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import { Billboard } from '@react-three/drei/webgpu';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { resolveTypeDisplayRadius } from '@atlas/core';
import { keepLupiAwake } from '@atlas/scene';
import { displayMotionScale } from './motion/comfort';
import { FollowAtom } from './play/displayFollow';

/** The selection pulse: 3.6 rad/s, ±3.5 %, fading to rest over this many seconds. */
const PULSE_SECONDS = 2.4;
const PULSE_OMEGA = 3.6;
const PULSE_AMPLITUDE = 0.035;

/** A ring geometry that is disposed when it is replaced or unmounted. */
function useRingGeometry(inner: number, outer: number, segments: number): THREE.RingGeometry {
  const geometry = useMemo(() => new THREE.RingGeometry(inner, outer, segments), [inner, outer, segments]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

interface SelectionMarkersProps {
  frame: Frame;
  selectedAtoms: number[];
  hoveredAtom: number | null;
  /** Optional raw-type display override. Core provenance resolution is used
   * when no explicit override exists. */
  typeRadii?: Record<number, number>;
  /** Atom indices to highlight as neighbors (dim everything else). */
  highlightedNeighbors?: Set<number>;
  /** Whether to dim non-neighbor atoms when a node is selected/hovered. */
  dimNonNeighbors?: boolean;
  /** Draw the hover ring (off where the impostor's own glow marks the hovered atom). */
  showHoverRing?: boolean;
}

export function SelectionMarkers({
  frame,
  selectedAtoms,
  hoveredAtom,
  typeRadii,
  highlightedNeighbors = new Set(),
  dimNonNeighbors = false,
  showHoverRing = true,
}: SelectionMarkersProps) {
  const radiusFor = (atomIndex: number): number => {
    if (atomIndex < 0 || atomIndex >= frame.natoms) return 0.5;
    const t = frame.types[atomIndex];
    if (typeRadii && typeRadii[t] != null) return typeRadii[t];
    return resolveTypeDisplayRadius(frame, t);
  };

  const positionOf = (atomIndex: number): [number, number, number] | null => {
    if (atomIndex < 0 || atomIndex >= frame.natoms) return null;
    return [
      frame.positions[atomIndex * 3],
      frame.positions[atomIndex * 3 + 1],
      frame.positions[atomIndex * 3 + 2],
    ];
  };

  // Determine active focus atom (selected takes priority over hovered)
  const focusAtom = selectedAtoms.length === 1 ? selectedAtoms[0] : hoveredAtom;
  const showDimming = dimNonNeighbors && focusAtom != null && highlightedNeighbors.size > 0;

  return (
    <group>
      {selectedAtoms.map((idx) => {
        const pos = positionOf(idx);
        if (!pos) return null;
        return (
          <FollowAtom key={`selected-${idx}`} frame={frame} atom={idx}>
            <SelectedMarker position={pos} radius={radiusFor(idx) * 1.26} />
          </FollowAtom>
        );
      })}
      {showHoverRing && hoveredAtom != null && !selectedAtoms.includes(hoveredAtom) && (() => {
        const pos = positionOf(hoveredAtom);
        if (!pos) return null;
        return (
          <FollowAtom key={`hover-${hoveredAtom}`} frame={frame} atom={hoveredAtom}>
            <HoverMarker position={pos} radius={radiusFor(hoveredAtom) * 1.20} />
          </FollowAtom>
        );
      })()}
      {showDimming && Array.from(highlightedNeighbors).map((idx) => {
        const pos = positionOf(idx);
        if (!pos) return null;
        return (
          <FollowAtom key={`neighbor-${idx}`} frame={frame} atom={idx}>
            <NeighborMarker position={pos} radius={radiusFor(idx) * 1.15} />
          </FollowAtom>
        );
      })}
    </group>
  );
}

function SelectedMarker({
  position,
  radius,
}: {
  position: [number, number, number];
  radius: number;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const ringGeo = useRingGeometry(radius * 0.94, radius * 1.06, 72);
  // The marker mounts with its selection: the pulse runs from here.
  const pulse = useRef({ start: -1, amplitude: 0 });

  useEffect(() => {
    pulse.current = { start: performance.now(), amplitude: PULSE_AMPLITUDE * displayMotionScale() };
    if (!(pulse.current.amplitude > 0)) return undefined;
    return keepLupiAwake('selection-pulse', () => performance.now() - pulse.current.start < PULSE_SECONDS * 1000);
  }, []);

  useFrame(() => {
    if (!ringRef.current) return;
    const { start, amplitude } = pulse.current;
    const t = start < 0 ? PULSE_SECONDS : (performance.now() - start) / 1000;
    const fade = t < PULSE_SECONDS ? (1 - t / PULSE_SECONDS) ** 2 : 0;
    ringRef.current.scale.setScalar(1 + Math.sin(t * PULSE_OMEGA) * amplitude * fade);
  });

  return (
    <Billboard position={position}>
      <mesh ref={ringRef} geometry={ringGeo}>
        <meshBasicMaterial
          color="#d5ef9c"
          side={THREE.DoubleSide}
          transparent
          opacity={0.9}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function HoverMarker({
  position,
  radius,
}: {
  position: [number, number, number];
  radius: number;
}) {
  const ringGeo = useRingGeometry(radius * 0.98, radius * 1.02, 48);
  return (
    <Billboard position={position}>
      <mesh geometry={ringGeo}>
        <meshBasicMaterial
          color="#cfe5ff"
          side={THREE.DoubleSide}
          transparent
          opacity={0.45}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}

function NeighborMarker({
  position,
  radius,
}: {
  position: [number, number, number];
  radius: number;
}) {
  const ringGeo = useRingGeometry(radius * 0.92, radius * 1.08, 64);
  return (
    <Billboard position={position}>
      <mesh geometry={ringGeo}>
        <meshBasicMaterial
          color="#a0ffc8"
          side={THREE.DoubleSide}
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </Billboard>
  );
}
