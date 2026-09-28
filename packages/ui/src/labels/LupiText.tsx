/**
 * LupiText.tsx — 3D text labels for the WebGPU viewer (plan-final §5.9, D11).
 *
 * Replaces drei's troika `<Text>`, which drei 11 only ships from `/legacy`
 * (the WebGL build). The props are the troika-compatible subset the label
 * layers use (AnnotationsLayer, KnowledgeLabelsLayer, MeasurementLayer).
 *
 * Seed (WP0): renders nothing. WP5 implements it as canvas-texture sprites.
 */
import type { JSX, ReactNode } from 'react';
import type * as THREE from 'three/webgpu';

export interface LupiTextProps {
  children: string | number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** World-space em height. */
  fontSize?: number;
  color?: THREE.ColorRepresentation;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  fontWeight?: 'normal' | 'bold';
  /** World units, or a percentage of fontSize (troika's string form, e.g. '8%'). */
  outlineWidth?: number | string;
  outlineColor?: THREE.ColorRepresentation;
  outlineOpacity?: number;
  maxWidth?: number;
  renderOrder?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  transparent?: boolean;
  opacity?: number;
}

export function LupiText(_props: LupiTextProps): JSX.Element | null {
  return null;
}

/** Shared label resources (glyph atlas, canvas cache). A pass-through until WP5 needs one. */
export function LupiTextProvider({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
