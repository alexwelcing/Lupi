/**
 * <LabelPerfHUD /> — small overlay showing live label-rendering metrics.
 *
 * Surfaces:
 *   - Number of labels currently rendered
 *   - Max label ceiling
 *   - Cull distance
 *   - Instant FPS (from window.__atlas.perf)
 *
 * Toggle via the Visuals panel or the store action `setShowLabelPerfHud`.
 */

import React, { useEffect, useState } from 'react';
import { useStore } from './store';

interface LabelPerfState {
  renderedLabels: number;
  maxCount: number;
  cullDistance: number;
  fps: number;
  frameTimeMs: number;
}

export function LabelPerfHUD() {
  const show = useStore((s) => s.showLabelPerfHud);
  const maxCount = useStore((s) => s.knowledgeLabelMaxCount);
  const cullDistance = useStore((s) => s.knowledgeLabelCullDistance);

  const [metrics, setMetrics] = useState<LabelPerfState>({
    renderedLabels: 0,
    maxCount,
    cullDistance,
    fps: 0,
    frameTimeMs: 0,
  });

  useEffect(() => {
    if (!show) return;
    const id = setInterval(() => {
      const w = (window as any).__atlas ?? {};
      const perf = w.perf ?? {};
      const labelPerf = w.labelPerf ?? {};
      setMetrics({
        renderedLabels: labelPerf.renderedLabels ?? 0,
        maxCount,
        cullDistance,
        fps: Math.round(perf.fps ?? 0),
        frameTimeMs: Math.round((perf.frameTimeMs ?? 0) * 10) / 10,
      });
    }, 500);
    return () => clearInterval(id);
  }, [show, maxCount, cullDistance]);

  if (!show) return null;

  const atLimit = metrics.renderedLabels >= metrics.maxCount;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        background: 'rgba(0, 0, 0, 0.72)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(30, 220, 224, 0.35)',
        borderLeft: '4px solid #1edce0',
        padding: '10px 14px',
        color: '#e5e2e1',
        fontFamily: 'monospace',
        fontSize: 11,
        zIndex: 200,
        pointerEvents: 'none',
        textTransform: 'uppercase',
        boxShadow: '0 0 20px rgba(30, 220, 224, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 180,
      }}
    >
      <div
        style={{
          fontWeight: 'bold',
          color: '#1edce0',
          letterSpacing: '0.1em',
          borderBottom: '1px solid rgba(30,220,224,0.2)',
          paddingBottom: 4,
          marginBottom: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span style={{ fontSize: 13 }}>📊</span>
        LABEL PERF
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '4px 14px',
        }}
      >
        <span style={{ opacity: 0.7 }}>Rendered:</span>
        <span
          style={{
            color: atLimit ? '#ff6b6b' : '#1edce0',
            fontWeight: 600,
          }}
        >
          {metrics.renderedLabels} / {metrics.maxCount}
        </span>

        <span style={{ opacity: 0.7 }}>Cull Dist:</span>
        <span style={{ color: '#1edce0', fontWeight: 600 }}>
          {metrics.cullDistance.toFixed(1)}
        </span>

        <span style={{ opacity: 0.7 }}>FPS:</span>
        <span
          style={{
            color: metrics.fps < 30 ? '#ff6b6b' : '#1edce0',
            fontWeight: 600,
          }}
        >
          {metrics.fps}
        </span>

        <span style={{ opacity: 0.7 }}>Frame Time:</span>
        <span style={{ color: '#1edce0', fontWeight: 600 }}>
          {metrics.frameTimeMs.toFixed(1)} ms
        </span>
      </div>

      {atLimit && (
        <div
          style={{
            fontSize: 9,
            color: '#ff6b6b',
            marginTop: 2,
            letterSpacing: '0.05em',
          }}
        >
          ⚠️ At max label count — raise ceiling or zoom in.
        </div>
      )}
    </div>
  );
}
