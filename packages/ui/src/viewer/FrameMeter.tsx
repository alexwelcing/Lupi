/**
 * <FrameMeter /> — a small read-out of the viewer's frame loop, for checking
 * Quiet Idle by eye on a phone (no console needed). Off unless the URL asks:
 * `?frames=1` (also inside a hash route, `#/mcp?frames=1`).
 *
 * It shows the frames drawn in the last second, the total, and what keeps the
 * loop awake (`camera-rig`, `display-motion`, `settle`, …). A still view
 * reads "idle · 0 fps". It is DOM only and never asks for a frame itself.
 */
import { useEffect, useState } from 'react';
import { lupiFrameStats } from '@atlas/scene';

const SAMPLE_MS = 250;

/** True when the page URL carries `frames=1` (search or hash query). */
export function frameMeterRequested(
  search: string = typeof location === 'undefined' ? '' : location.search,
  hash: string = typeof location === 'undefined' ? '' : location.hash,
): boolean {
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const value = new URLSearchParams(search).get('frames') ?? new URLSearchParams(hashQuery).get('frames');
  return value === '1' || value === 'true';
}

interface MeterReading {
  fps: number;
  total: number;
  awakeBy: string[];
}

export function FrameMeter({ frameloop }: { frameloop: 'always' | 'demand' }) {
  const [reading, setReading] = useState<MeterReading>({ fps: 0, total: 0, awakeBy: [] });

  useEffect(() => {
    // A one-second window of (time, rendered) samples.
    const samples: Array<{ t: number; rendered: number }> = [];
    const tick = () => {
      const stats = lupiFrameStats();
      const t = performance.now();
      samples.push({ t, rendered: stats.rendered });
      while (samples.length > 1 && t - samples[0].t > 1000) samples.shift();
      const first = samples[0];
      const span = (t - first.t) / 1000;
      const fps = span > 0 ? Math.round((stats.rendered - first.rendered) / span) : 0;
      setReading({ fps, total: stats.rendered, awakeBy: stats.awake ? stats.awakeBy : [] });
    };
    tick();
    const id = setInterval(tick, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  const idle = reading.fps === 0 && reading.awakeBy.length === 0;
  const why = frameloop === 'always' ? 'always' : idle ? 'idle' : reading.awakeBy.join(', ') || 'drawing';
  return (
    <div
      role="status"
      aria-label="Frame meter"
      data-lupi-frame-meter=""
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 9px',
        borderRadius: 999,
        background: 'rgba(16, 24, 23, 0.82)',
        border: '1px solid rgba(213, 239, 156, 0.28)',
        color: '#d5ef9c',
        font: '500 11px/1.4 var(--font-mono, ui-monospace, monospace)',
        whiteSpace: 'nowrap',
        maxWidth: 'calc(100vw - 32px)',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          background: idle ? 'rgba(213, 239, 156, 0.35)' : '#d5ef9c',
          flex: 'none',
        }}
      />
      <span>{reading.fps} fps</span>
      <span style={{ opacity: 0.6 }}>· {why}</span>
      <span style={{ opacity: 0.45 }}>· {reading.total}</span>
    </div>
  );
}
