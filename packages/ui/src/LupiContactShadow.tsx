/**
 * LupiContactShadow.tsx — the soft floor shadow under a molecule
 * (plan-final §5.11).
 *
 * Replaces drei's ContactShadows, which draws nothing on the WebGPU backend
 * and a Y-flipped shadow on WebGL2 (lead probe L5). The props are the
 * ContactShadows props the viewer used, plus the frame (atom positions and
 * types, for radii) and the hidden atom types, so WP3b can splat the shadow
 * on the CPU instead of rendering the scene from below.
 *
 * Seed (WP0): renders nothing.
 */
import type { JSX } from 'react';
import type * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';

export interface LupiContactShadowProps {
  position?: [number, number, number];
  /** Plane size in world units (square). */
  scale?: number;
  blur?: number;
  /** How far above the plane atoms still cast, world units. */
  far?: number;
  opacity?: number;
  /** Shadow texture size, px. */
  resolution?: number;
  /** Frames to (re)compute; 0 keeps the last result. */
  frames?: number;
  color?: THREE.ColorRepresentation;
  frame: Frame;
  hiddenAtomTypes: ReadonlySet<number>;
}

export function LupiContactShadow(_props: LupiContactShadowProps): JSX.Element | null {
  return null;
}
