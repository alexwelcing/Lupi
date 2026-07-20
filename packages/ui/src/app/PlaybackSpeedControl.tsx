export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;
export type PlaybackSpeed = typeof PLAYBACK_SPEEDS[number];

export function nextPlaybackSpeed(current: number): PlaybackSpeed {
  const index = PLAYBACK_SPEEDS.findIndex(speed => speed === current);
  return index < 0 ? PLAYBACK_SPEEDS[0] : PLAYBACK_SPEEDS[(index + 1) % PLAYBACK_SPEEDS.length];
}

export function PlaybackSpeedControl({
  isMobile,
  playbackSpeed,
  onChange,
}: {
  isMobile: boolean;
  playbackSpeed: number;
  onChange: (speed: PlaybackSpeed) => void;
}) {
  if (isMobile) {
    return (
      <button
        type="button"
        data-testid="mobile-playback-speed"
        aria-label={`Playback speed ${playbackSpeed}×. Tap to cycle speed.`}
        onClick={() => onChange(nextPlaybackSpeed(playbackSpeed))}
        style={{
          minWidth: 64,
          minHeight: 44,
          padding: '9px 12px',
          flexShrink: 0,
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          color: '#031314',
          background: '#1edce0',
          border: '1px solid #1edce0',
          borderRadius: 8,
          cursor: 'pointer',
          touchAction: 'manipulation',
        }}
      >
        {playbackSpeed}×
      </button>
    );
  }

  return (
    <div data-testid="desktop-playback-speeds" style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      {PLAYBACK_SPEEDS.map(speed => (
        <button
          type="button"
          key={speed}
          aria-label={`Set playback speed ${speed}×`}
          aria-pressed={playbackSpeed === speed}
          onClick={() => onChange(speed)}
          style={{
            padding: '6px 8px',
            minWidth: 36,
            fontSize: 10,
            fontFamily: 'var(--font-mono)',
            fontWeight: playbackSpeed === speed ? 600 : 400,
            color: playbackSpeed === speed ? '#031314' : '#94a3b8',
            background: playbackSpeed === speed ? '#1edce0' : '#121418',
            border: `1px solid ${playbackSpeed === speed ? '#1edce0' : '#334155'}`,
            borderRadius: 0,
            cursor: 'pointer',
            transition: 'all 100ms ease-out',
          }}
        >
          {speed}×
        </button>
      ))}
    </div>
  );
}
