/**
 * AxesGizmo.tsx — the viewer's orientation gizmo (plan-final §5.10, Q5).
 *
 * Replaces drei's GizmoHelper/GizmoViewport: drei 11's Hud renders from a
 * positive-priority useFrame with a raw renderer.render, which disables
 * R3F v10's default render and bypasses the render pipeline (K21). This is a
 * small SVG overlay in the canvas container instead. It is built once with
 * DOM calls (no React re-render per frame); a `finish`-phase job
 * (`LUPI_JOB.axesGizmo`) moves the axis endpoints from the camera
 * orientation and writes attributes only when they change.
 *
 * Exports draw the same indicator into the raster (drawExportAxesOverlayV1),
 * since a capture renders the scene only.
 */
import { useEffect, useRef, type JSX } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { Quaternion, Vector3 } from 'three';
import { LUPI_JOB } from '@atlas/scene';

export interface AxesGizmoProps {
  alignment: 'bottom-left';
  /** Offset of the gizmo centre from the aligned corner, CSS px. */
  margin: [number, number];
  /** X, Y, Z axis colours. */
  axisColors: [string, string, string];
  labelColor: string;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Axis length in CSS px. */
const AXIS_RADIUS = 34;
const HEAD_RADIUS = 9;
const BOX = (AXIS_RADIUS + HEAD_RADIUS + 3) * 2;
const CENTER = BOX / 2;
const LABELS = ['X', 'Y', 'Z'] as const;
const DIRECTIONS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)] as const;

interface AxisNodes {
  group: SVGGElement;
  line: SVGLineElement;
  head: SVGCircleElement;
  label: SVGTextElement;
}

interface GizmoNodes {
  root: SVGSVGElement;
  axes: AxisNodes[];
  /** Last written endpoints and paint order, to skip unchanged frames. */
  last: string;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

function buildGizmo(props: AxesGizmoProps): GizmoNodes {
  const root = svg('svg', {
    width: BOX,
    height: BOX,
    viewBox: `0 0 ${BOX} ${BOX}`,
    'data-testid': 'axes-gizmo',
    role: 'img',
    'aria-label': 'Axes orientation',
  });
  Object.assign(root.style, {
    position: 'absolute',
    left: `${props.margin[0] - CENTER}px`,
    bottom: `${props.margin[1] - CENTER}px`,
    pointerEvents: 'none',
    overflow: 'visible',
    zIndex: '1',
  });
  root.appendChild(svg('circle', { cx: CENTER, cy: CENTER, r: AXIS_RADIUS + HEAD_RADIUS - 2, fill: 'rgba(8, 13, 24, 0.42)' }));
  const axes = LABELS.map((label, index) => {
    const color = props.axisColors[index];
    const group = svg('g', { 'data-axis': label });
    const line = svg('line', {
      x1: CENTER,
      y1: CENTER,
      x2: CENTER,
      y2: CENTER,
      stroke: color,
      'stroke-width': 3,
      'stroke-linecap': 'round',
    });
    const head = svg('circle', { cx: CENTER, cy: CENTER, r: HEAD_RADIUS, fill: color });
    const text = svg('text', {
      x: CENTER,
      y: CENTER,
      fill: props.labelColor,
      'font-size': 11,
      'font-weight': 700,
      'font-family': 'ui-sans-serif, system-ui, sans-serif',
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
    });
    text.textContent = label;
    group.append(line, head, text);
    root.appendChild(group);
    return { group, line, head, label: text };
  });
  return { root, axes, last: '' };
}

/** Axis endpoints (CSS px in the SVG) and back-to-front order for a camera orientation. */
export function projectGizmoAxes(cameraQuaternion: Quaternion): { x: number; y: number; depth: number }[] {
  const inverse = cameraQuaternion.clone().invert();
  return DIRECTIONS.map((direction) => {
    const view = direction.clone().applyQuaternion(inverse);
    return { x: CENTER + view.x * AXIS_RADIUS, y: CENTER - view.y * AXIS_RADIUS, depth: view.z };
  });
}

export function AxesGizmo(props: AxesGizmoProps): JSX.Element | null {
  const renderer = useThree((state) => state.renderer);
  const nodesRef = useRef<GizmoNodes | null>(null);
  const { alignment, labelColor } = props;
  const [marginX, marginY] = props.margin;
  const [xColor, yColor, zColor] = props.axisColors;

  useEffect(() => {
    const canvas = renderer.domElement as HTMLCanvasElement | undefined;
    // fiber's Canvas: <div style="position:relative"><div><canvas/></div></div>.
    const host = canvas?.parentElement?.parentElement ?? canvas?.parentElement;
    if (!host || typeof document === 'undefined') return;
    const nodes = buildGizmo({ alignment, margin: [marginX, marginY], axisColors: [xColor, yColor, zColor], labelColor });
    host.appendChild(nodes.root);
    nodesRef.current = nodes;
    return () => {
      nodes.root.remove();
      if (nodesRef.current === nodes) nodesRef.current = null;
    };
  }, [renderer, alignment, marginX, marginY, xColor, yColor, zColor, labelColor]);

  useFrame(
    (state) => {
      const nodes = nodesRef.current;
      if (!nodes) return;
      const projected = projectGizmoAxes(state.camera.quaternion);
      const order = [0, 1, 2].sort((a, b) => projected[a].depth - projected[b].depth);
      const key = projected.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(';') + `|${order.join('')}`;
      if (key === nodes.last) return;
      nodes.last = key;
      projected.forEach((point, index) => {
        const axis = nodes.axes[index];
        const x = point.x.toFixed(2);
        const y = point.y.toFixed(2);
        axis.line.setAttribute('x2', x);
        axis.line.setAttribute('y2', y);
        axis.head.setAttribute('cx', x);
        axis.head.setAttribute('cy', y);
        axis.label.setAttribute('x', x);
        axis.label.setAttribute('y', y);
        // Axes pointing away from the viewer read dimmer.
        axis.group.setAttribute('opacity', point.depth < -0.2 ? '0.55' : '1');
      });
      // Paint back to front: nearer axes last.
      for (const index of order) nodes.root.appendChild(nodes.axes[index].group);
    },
    { phase: 'finish', id: LUPI_JOB.axesGizmo },
  );

  return null;
}
