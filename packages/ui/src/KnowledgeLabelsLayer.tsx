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

import { useState, useEffect, useRef } from 'react';
import { Html, Text, Billboard } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore, type KnowledgeLabel } from './store';
import { selectVisibleLabels } from './knowledgeLabels/selectVisibleLabels';
import { emitHerdrTask } from './herdr/herdrEvents';

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
  const searchQuery = useStore((s) => s.knowledgeLabelSearchQuery);
  const searchFilter = useStore((s) => s.knowledgeLabelSearchFilter);
  const pinnedIds = useStore((s) => s.pinnedKnowledgeLabelIds);
  const herdrTaskNodeIds = useStore((s) => s.herdrTaskNodeIds);

  const { camera } = useThree();
  const camPosRef = useRef(new THREE.Vector3());
  const lastCamRef = useRef(new THREE.Vector3());
  const lastHoverRef = useRef<number | null>(null);
  const frameRef = useRef(0);
  const [visibleLabels, setVisibleLabels] = useState<KnowledgeLabel[]>([]);
  const [hoverLabelToRender, setHoverLabelToRender] = useState<KnowledgeLabel | undefined>();
  const [renderedCount, setRenderedCount] = useState(0);
  const lastReportRef = useRef(0);

  const computeVisible = (camPos: THREE.Vector3) =>
    selectVisibleLabels({
      labels,
      visibleKinds,
      visible,
      threshold,
      maxCount,
      cullDistance,
      cameraPosition: [camPos.x, camPos.y, camPos.z],
      hoveredAtom,
    });

  const reportLabelPerf = (count: number) => {
    if (typeof window !== 'undefined') {
      const w = window as any;
      w.__atlas = w.__atlas ?? {};
      w.__atlas.labelPerf = {
        renderedLabels: count,
        maxCount,
        cullDistance,
        timestamp: performance.now(),
      };
    }
  };

  // Recompute immediately when non-camera dependencies change.
  useEffect(() => {
    camera.getWorldPosition(camPosRef.current);
    const result = computeVisible(camPosRef.current);
    setVisibleLabels(result.visibleLabels);
    setHoverLabelToRender(result.hoverLabelToRender);
    const count = result.visibleLabels.length + (result.hoverLabelToRender ? 1 : 0);
    setRenderedCount(count);
    reportLabelPerf(count);
    lastCamRef.current.copy(camPosRef.current);
    lastHoverRef.current = hoveredAtom;
  }, [labels, visibleKinds, visible, threshold, maxCount, cullDistance, hoveredAtom, camera]);

  // Recompute as the camera moves so distance culling stays accurate.
  useFrame(() => {
    frameRef.current += 1;
    camera.getWorldPosition(camPosRef.current);
    const moved = camPosRef.current.distanceToSquared(lastCamRef.current) > 0.04;
    const hoverChanged = hoveredAtom !== lastHoverRef.current;
    if (frameRef.current % 3 !== 0 && !moved && !hoverChanged) return;

    lastCamRef.current.copy(camPosRef.current);
    lastHoverRef.current = hoveredAtom;
    const result = computeVisible(camPosRef.current);
    setVisibleLabels(result.visibleLabels);
    setHoverLabelToRender(result.hoverLabelToRender);

    const now = performance.now();
    const count = result.visibleLabels.length + (result.hoverLabelToRender ? 1 : 0);
    if (count !== renderedCount) setRenderedCount(count);

    if (now - lastReportRef.current > 500) {
      lastReportRef.current = now;
      reportLabelPerf(count);
    }
  });

  if (!visible || labels.length === 0) return null;

  const handleSelectAtom = (atomIndex: number) => {
    useStore.getState().setSelectedAtoms([atomIndex]);
  };

  const handleFocusSphere = (sphereIndex: number) => {
    const sphereLabel = labels.find((l) => l.kind === 'sphere' && l.sphereIndex === sphereIndex);
    if (sphereLabel) {
      useStore.getState().setCameraState(
        [sphereLabel.position[0] + 8, sphereLabel.position[1] + 8, sphereLabel.position[2] + 8],
        sphereLabel.position,
      );
    }
  };

  const handleCreateTask = (label: KnowledgeLabel) => {
    if (!label.nodeId) return;
    emitHerdrTask({
      nodeId: label.nodeId,
      nodeKind: label.nodeKind,
      text: label.text,
      sphereId: label.sphereId,
      degree: label.degree,
      salience: label.salience,
      position: label.position,
      source: 'lupi-viewer',
    });
  };

  return (
    <group>
      {visibleLabels.map((label) => {
        const pos = label.position;
        const isMatch = labelMatches(label, searchQuery, searchFilter);
        const isPinned = pinnedIds.has(label.id);
        if (style === 'glyph') {
          return <GlyphLabel key={label.id} pos={pos} text={label.text} kind={label.kind} />;
        }
        return (
          <CardLabel
            key={label.id}
            pos={pos}
            text={label.text}
            detail={label.detail}
            kind={label.kind}
            atomIndex={label.atomIndex}
            sphereIndex={label.sphereIndex}
            nodeId={label.nodeId}
            onSelectAtom={handleSelectAtom}
            onFocusSphere={handleFocusSphere}
            onCreateTask={() => handleCreateTask(label)}
            isMatch={isMatch}
            isPinned={isPinned}
            hasTask={label.nodeId ? herdrTaskNodeIds.has(label.nodeId) : false}
          />
        );
      })}
      {hoverLabelToRender && (
        <CardLabel
          key={`${hoverLabelToRender.id}-hover`}
          pos={hoverLabelToRender.position}
          text={hoverLabelToRender.text}
          detail={hoverLabelToRender.detail}
          kind={hoverLabelToRender.kind}
          atomIndex={hoverLabelToRender.atomIndex}
          sphereIndex={hoverLabelToRender.sphereIndex}
          nodeId={hoverLabelToRender.nodeId}
          onSelectAtom={handleSelectAtom}
          onFocusSphere={handleFocusSphere}
          onCreateTask={() => handleCreateTask(hoverLabelToRender)}
          isMatch={labelMatches(hoverLabelToRender, searchQuery, searchFilter)}
          isPinned={pinnedIds.has(hoverLabelToRender.id)}
          hasTask={hoverLabelToRender.nodeId ? herdrTaskNodeIds.has(hoverLabelToRender.nodeId) : false}
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
  atomIndex,
  sphereIndex,
  nodeId,
  onSelectAtom,
  onFocusSphere,
  onCreateTask,
  isMatch,
  isPinned,
  hasTask,
}: {
  pos: [number, number, number];
  text: string;
  detail?: string;
  kind: string;
  atomIndex?: number;
  sphereIndex?: number;
  nodeId?: string;
  onSelectAtom?: (atomIndex: number) => void;
  onFocusSphere?: (sphereIndex: number) => void;
  onCreateTask?: () => void;
  isMatch?: boolean;
  isPinned?: boolean;
  hasTask?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const tint = kind === 'sphere' ? '#8bd3ff' : kind === 'node' ? '#a0ffc8' : '#d8b4fe';
  const title = detail ? `${text}\n${detail}` : text;
  const borderColor = hasTask
    ? '#ff6b6b'
    : isMatch ? '#fbbf24' : isPinned ? '#1edce0' : `${tint}${hover ? '88' : '55'}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (kind === 'node' && atomIndex != null && onSelectAtom) {
      onSelectAtom(atomIndex);
    } else if (kind === 'sphere' && sphereIndex != null && onFocusSphere) {
      onFocusSphere(sphereIndex);
    }
  };

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
          onClick={handleClick}
          style={{
            maxWidth: hover ? 360 : 220,
            background: hover ? 'rgba(10, 18, 32, 0.94)' : 'rgba(10, 18, 32, 0.86)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            border: `1px solid ${borderColor}`,
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
            cursor: kind === 'node' || kind === 'sphere' ? 'pointer' : 'default',
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
          {hover && nodeId && onCreateTask && (
            <div style={{ marginTop: 4, display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCreateTask(); }}
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid rgba(160, 255, 200, 0.4)',
                  background: 'rgba(160, 255, 200, 0.1)',
                  color: '#a0ffc8',
                  cursor: 'pointer',
                }}
              >
                HERDR task
              </button>
            </div>
          )}
        </div>
      </Html>
    </group>
  );
}

function labelMatches(label: KnowledgeLabel, query: string, filter: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const textMatch = label.text.toLowerCase().includes(q);
  const nodeIdMatch = label.nodeId?.toLowerCase().includes(q) ?? false;
  const nodeKindMatch = label.nodeKind?.toLowerCase().includes(q) ?? false;
  const sphereIdMatch = label.sphereId?.toLowerCase().includes(q) ?? false;
  switch (filter) {
    case 'text': return textMatch;
    case 'nodeId': return nodeIdMatch;
    case 'nodeKind': return nodeKindMatch;
    case 'sphereId': return sphereIdMatch;
    default: return textMatch || nodeIdMatch || nodeKindMatch || sphereIdMatch;
  }
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
