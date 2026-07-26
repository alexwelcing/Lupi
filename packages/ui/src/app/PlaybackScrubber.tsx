/**
 * PlaybackScrubber — the transport-bar frame control.
 *
 * Science-bound loads (Z1 reaction-path sequences) get a dedicated zero-based
 * NEB-image slider: `ThermoMinimap` is forbidden for this data (its missing-
 * `Temp` fallback can color image index as if it were temperature, and an NEB
 * sequence is not a time series). Every other load keeps the minimap.
 */
import type { ThermoData } from '@atlas/core/types';
import { ThermoMinimap } from '../ThermoMinimap';

interface PlaybackScrubberProps {
  hasScience: boolean;
  thermo: ThermoData | null;
  totalFrames: number;
  currentFrame: number;
  onFrameChange: (frame: number) => void;
}

export function PlaybackScrubber({
  hasScience,
  thermo,
  totalFrames,
  currentFrame,
  onFrameChange,
}: PlaybackScrubberProps) {
  if (hasScience) {
    return (
      <input
        type="range"
        data-testid="neb-image-scrubber"
        aria-label="Reaction-path sequence NEB image (zero-based)"
        min={0}
        max={Math.max(totalFrames - 1, 0)}
        step={1}
        value={Math.min(Math.floor(currentFrame), Math.max(totalFrames - 1, 0))}
        onChange={(event) => onFrameChange(Number(event.currentTarget.value))}
        style={{ flex: 1, minWidth: 80, accentColor: '#22d3d7' }}
      />
    );
  }

  return (
    <ThermoMinimap
      thermo={thermo}
      totalFrames={totalFrames}
      currentFrame={currentFrame}
      onFrameChange={onFrameChange}
    />
  );
}
