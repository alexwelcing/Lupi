import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackScrubber } from './PlaybackScrubber';

describe('PlaybackScrubber', () => {
  it('uses a zero-based NEB image slider — not ThermoMinimap — for science loads', () => {
    render(
      <PlaybackScrubber
        hasScience
        thermo={null}
        totalFrames={5}
        currentFrame={2}
        onFrameChange={vi.fn()}
      />,
    );

    const slider = screen.getByRole('slider', { name: 'Reaction-path sequence NEB image (zero-based)' });
    expect(slider).toBeTruthy();
    expect(slider.getAttribute('min')).toBe('0');
    expect(slider.getAttribute('max')).toBe('4');
    expect(slider.getAttribute('value')).toBe('2');
    // ThermoMinimap is forbidden for reaction-path sequences.
    expect(screen.queryByTestId('frame-scrubber')).toBeNull();
  });

  it('drives the shared frame state from the NEB slider', () => {
    const onFrameChange = vi.fn();
    render(
      <PlaybackScrubber
        hasScience
        thermo={null}
        totalFrames={7}
        currentFrame={0}
        onFrameChange={onFrameChange}
      />,
    );

    fireEvent.change(screen.getByRole('slider'), { target: { value: '5' } });
    expect(onFrameChange).toHaveBeenCalledWith(5);
  });

  it('keeps ThermoMinimap for ordinary loads', () => {
    render(
      <PlaybackScrubber
        hasScience={false}
        thermo={null}
        totalFrames={5}
        currentFrame={2}
        onFrameChange={vi.fn()}
      />,
    );

    expect(screen.getByTestId('frame-scrubber')).toBeTruthy();
    expect(screen.queryByRole('slider', { name: 'Reaction-path sequence NEB image (zero-based)' })).toBeNull();
  });
});
