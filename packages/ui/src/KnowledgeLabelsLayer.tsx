/**
 * <KnowledgeLabelsLayer /> — Auto-generated semantic labels for gallery assets.
 *
 * Unlike user annotations, these labels are tied to a fixed 3D position
 * supplied by the loaded asset's metadata (e.g. sphere centroids and key
 * node positions from the Lupine Wiki sphere-grid export). They are always
 * billboarded toward the camera and use a small callout style that stays
 * readable against the molecular scene.
 *
 * Round A performance improvements:
 * - Camera-distance culling: labels farther than `cullDistance` are hidden.
 * - Max label ceiling: only the closest `maxCount` labels render.
 * - Frame-time telemetry: label count and FPS are reported to the store
 *   and optionally surfaced in a HUD.
 */

import { useState, useMemo, useRef } from 'react';
import { Html, Text, Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, type KnowledgeLabel } from './store';

export type KnowledgeLabelStyle = 'card' | 'glyph';

interface KnowledgeLabelsLayerProps {
  labels: KnowledgeLabel[];
  visibleKinds: Set<string>;
  style?: KnowledgeLabelStyle;
  /** Global toggle; labels are also filtered per-kind by visibleKinds. */
  visible?: boolean;
}

export function KnowledgeLabelsLayer({
  labels,
  visibleKinds,
  style = 'card',
  visible = true,
}: KnowledgeLabelsLayerProps) {
  const hoveredAtom = useStore((s) => s.hoveredAtom);
  const threshold = useStore((s) => s.knowledgeLabelThreshold);
  const maxCount = useStore((s) => s.knowledgeLabelMaxCount);
  const cullDistance = useStore((s) => s.knowledgeLabelCullDistance);
  const showPerfHud = useStore((s) => s.showLabelPerfHud);
  const setShowLabelPerfHud = useStore((s) => s.setShowLabelPerfHud);

  const { camera } = useThree();
  const camPosRef = useRef(new THREE.Vector3());
  const [renderedCount, setRenderedCount] = useState(0);
  const frameTimeRef = useRef(0);
  const lastReportRef = useRef(0);

  // Compute visible labels with distance culling and max-count ceiling.
  const { visibleLabels, hoverLabelToRender } = useMemo(() => {
    if (!visible || labels.length === 0) {
      return { visibleLabels: [] as KnowledgeLabel[], hoverLabelToRender: undefined as KnowledgeLabel | undefined };
    }

    camera.getWorldPosition(camPosRef.current);
    const cx = camPosRef.current.x;
    const cy = camPosRef.current.y;
    const cz = camPosRef.current.z;

    const scored: Array<{ label: KnowledgeLabel; dist: number }> = [];
    for (const label of labels) {
      if (!visibleKinds.has(label.kind)) continue;
      if (label.kind === 'sphere') {
        // Spheres always count but still respect distance culling.
        const dx = label.position[0] - cx;
        const dy = label.position[1] - cy;
        const dz = label.position[2] - cz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist <= cullDistance) scored.push({ label, dist });
        continue;
      }
      if ((label.salience ?? 0) < threshold) continue;
      const dx = label.position[0] - cx;
      const dy = label.position[1] - cy;
      const dz = label.position[2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist <= cullDistance) scored.push({ label, dist });
    }

    // Sort by distance ascending; keep only the closest maxCount.
    scored.sort((a, b) => a.dist - b.dist);
    const kept = scored.slice(0, maxCount).map((s) => s.label);

    const visibleIds = new Set(kept.map((l) => l.id));
    const hoveredLabel =
      hoveredAtom != null
        ? labels.find((l) => l.kind === 'node' && l.atomIndex === hoveredAtom && visibleKinds.has('node'))
        : undefined;
    const hoverLabelToRender =
      hoveredLabel && !visibleIds.has(hoveredLabel.id) ? hoveredLabel : undefined;

    return { visibleLabels: kept, hoverLabelToRender };
  }, [labels, visibleKinds, visible, threshold, maxCount, cullDistance, camera, hoveredAtom]);

  // Telemetry: report label count and frame time every 500ms.
  useFrame(() => {
    const now = performance.now();
    const count = visibleLabels.length + (hoverLabelToRender ? 1 : 0);
    if (count !== renderedCount) setRenderedCount(count);
    frameTimeRef.current = now;

    if (now - lastReportRef.current > 500) {
      lastReportRef.current = now;
      // Write to window for external HUDs / DevProbe to pick up.
      if (typeof window !== 'undefined') {
        const w = window as any;
        w.__atlas = w.__atlas ?? {};
        w.__atlas.labelPerf = {
          renderedLabels: count,
          maxCount,
          cullDistance,
          timestamp: now,
        };
      }
    }
  });

  if (!visible || labels.length === 0) return null;

  return (
    <group>
      {visibleLabels.map((label) => {
        const pos = label.position;
        if (style === 'glyph') {
          return <GlyphLabel key={label.id} pos={pos} text={label.text} kind={label.kind} />;
        }
        return <CardLabel key={label.id} pos={pos} text={label.text} detail={label.detail} kind={label.kind} />;
      })}
      {hoverLabelToRender && (
        <CardLabel
          key={`${hoverLabelToRender.id}-hover`}
          pos={hoverLabelToRender.position}
          text={hoverLabelToRender.text}
          detail={hoverLabelToRender.detail}
          kind={hoverLabelToRender.kind}
        />
      )}
    </group>
  );
}

function CardLabel({
  pos,
  text,
  detail,
  kind,
}: {
  pos: [number, number, number];
  text: string;
  detail?: string;
  kind: string;
}) {
  const [hover, setHover] = useState(false);
  const tint = kind === 'sphere' ? '#8bd3ff' : kind === 'node' ? '#a0ffc8' : '#d8b4fe';
  const title = detail ? `${text}\n${detail}` : text;
  return (
    <group position={pos}>
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.012, 0.012, 1.6, 4]} />
        <meshBasicMaterial color={tint} transparent opacity={0.5} />
      </mesh>
      <Html
        position={[0, 1.7, 0]}
        center
        distanceFactor={10}
        occlude={false}
        style={{ pointerEvents: 'auto' }}
      >
        <div
          title={title}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          style={{
            maxWidth: hover ? 360 : 220,
            background: hover ? 'rgba(10, 18, 32, 0.94)' : 'rgba(10, 18, 32, 0.86)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: `1px solid ${tint}${hover ? '88' : '55'}`,
            borderRadius: 8,
            padding: '5px 9px',
            color: 'rgba(240, 248, 255, 0.96)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '0.01em',
            whiteSpace: hover ? 'normal' : 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.45)',
            userSelect: 'none',
            transition: 'max-width 0.15s ease, background 0.15s ease',
            cursor: 'default',
          }}
        >
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</div>
          {detail && (
            <div
              title={detail}
              style={{
                fontSize: 10,
                fontWeight: 400,
                color: 'rgba(180, 205, 235, 0.8)',
                marginTop: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {detail}
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

function GlyphLabel({
  pos,
  text,
  kind,
}: {
  pos: [number, number, number];
  text: string;
  kind: string;
}) {
  const tint = kind === 'sphere' ? '#8bd3ff' : kind === 'node' ? '#a0ffc8' : '#d8b4fe';
  return (
    <Billboard position={[pos[0], pos[1] + 1.4, pos[2]]} follow>
      <Text
        fontSize={0.48}
        color={tint}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#0a1220"
        outlineOpacity={0.92}
      >
        {text}
      </Text>
    </Billboard>
  );
}
