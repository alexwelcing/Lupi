/**
 * AxesGizmo.tsx — the viewer's orientation gizmo (plan-final §5.10).
 *
 * Replaces drei's GizmoHelper/GizmoViewport: drei 11's Hud renders from a
 * positive-priority useFrame with a raw renderer.render, which disables
 * R3F v10's default render and bypasses the render pipeline (K21). WP6
 * builds it as a small DOM/SVG overlay driven by a `lupi/axes-gizmo` job.
 *
 * Seed (WP0): renders nothing.
 */
import type { JSX } from 'react';

export interface AxesGizmoProps {
  alignment: 'bottom-left';
  /** Offset from the aligned corner, CSS px. */
  margin: [number, number];
  /** X, Y, Z axis colours. */
  axisColors: [string, string, string];
  labelColor: string;
}

export function AxesGizmo(_props: AxesGizmoProps): JSX.Element | null {
  return null;
}
