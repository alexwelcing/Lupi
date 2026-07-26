import { useStore } from '../store';
import { Badge } from '../primitives/AppShell';

export function PlaybackStatus({
  frame,
  totalFrames,
  showFrame = true,
}: {
  frame: number;
  totalFrames: number;
  showFrame?: boolean;
}) {
  const file = useStore(s => s.file);
  // Science loads are zero-based NEB image sequences: every readout follows
  // the reaction-path convention (no "FRAME 1/5" contradictions).
  const hasScience = Boolean(file?.science);
  const streamingFrameStatus = (() => {
    if (!file || file.trajectory.totalFrames <= 1) return null;
    const bufferedFrameCount = file.trajectory.frames.reduce((count, candidate) => count + (candidate ? 1 : 0), 0);
    if (bufferedFrameCount >= file.trajectory.totalFrames) return null;
    const frameIsBuffered = Boolean(file.trajectory.frames[frame]);
    if (!frameIsBuffered) {
      return {
        tone: 'buffering' as const,
        label: 'Buffering',
        detail: hasScience
          ? `${Math.floor(frame)}/${file.trajectory.totalFrames - 1}`
          : `${Math.floor(frame) + 1}/${file.trajectory.totalFrames}`,
      };
    }
    return {
      tone: 'warming' as const,
      label: 'Buffered',
      detail: `${bufferedFrameCount}/${file.trajectory.totalFrames}`,
    };
  })();

  // On mobile the transport already owns the frame readout. If the whole
  // trajectory is resident there is no streaming state left to communicate.
  if (!showFrame && !streamingFrameStatus) return null;

  return (
    <div
      className="lupine-overlay lupine-overlay--top-left"
      data-testid="playback-status"
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
        {showFrame && (
          hasScience ? (
            <>
              <span style={{ color: 'rgba(203,213,225,0.56)', fontSize: 10, textTransform: 'uppercase' }}>NEB image</span>
              {frame} of {totalFrames - 1}
            </>
          ) : (
            <>
              <span style={{ color: 'rgba(203,213,225,0.56)', fontSize: 10, textTransform: 'uppercase' }}>Frame</span>
              {frame + 1} / {totalFrames}
            </>
          )
        )}
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
