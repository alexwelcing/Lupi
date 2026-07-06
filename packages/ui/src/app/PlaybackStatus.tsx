import { useStore } from '../store';
import { Badge } from '../primitives/AppShell';

export function PlaybackStatus({ frame, totalFrames }: { frame: number; totalFrames: number }) {
  const streamingFrameStatus = useStore(s => {
    const file = s.file;
    if (!file || file.trajectory.totalFrames <= 1) return null;
    const bufferedFrameCount = file.trajectory.frames.reduce((count, candidate) => count + (candidate ? 1 : 0), 0);
    if (bufferedFrameCount >= file.trajectory.totalFrames) return null;
    const frameIsBuffered = Boolean(file.trajectory.frames[s.frame]);
    if (!frameIsBuffered) {
      return {
        tone: 'buffering' as const,
        label: 'Buffering',
        detail: `${Math.floor(s.frame) + 1}/${file.trajectory.totalFrames}`,
      };
    }
    return {
      tone: 'warming' as const,
      label: 'Buffered',
      detail: `${bufferedFrameCount}/${file.trajectory.totalFrames}`,
    };
  });

  return (
    <div
      className="lupine-overlay lupine-overlay--top-left"
      style={{ top: 16, left: 16, pointerEvents: 'none' }}
    >
      <div className="lupine-glass-panel" style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 7,
        padding: '7px 10px',
        fontSize: 12,
        fontWeight: 700,
        color: '#f8fafc',
        fontVariantNumeric: 'tabular-nums',
      }}>
        <span style={{ color: 'rgba(203,213,225,0.56)', fontSize: 10, textTransform: 'uppercase' }}>Frame</span>
        {frame + 1} / {totalFrames}
        {streamingFrameStatus && (
          <Badge
            tone={streamingFrameStatus.tone}
            role="status"
            aria-live="polite"
            aria-busy={streamingFrameStatus.tone === 'buffering'}
            data-testid="streaming-frame-status"
            data-state={streamingFrameStatus.tone}
          >
            {streamingFrameStatus.label}
            <span style={{ color: 'rgba(248,250,252,0.72)', fontWeight: 700 }}>
              {streamingFrameStatus.detail}
            </span>
          </Badge>
        )}
      </div>
    </div>
  );
}
