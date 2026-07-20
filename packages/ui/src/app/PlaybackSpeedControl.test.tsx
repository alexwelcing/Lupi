import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PlaybackSpeedControl, type PlaybackSpeed } from './PlaybackSpeedControl';

function MobileHarness() {
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  return <PlaybackSpeedControl isMobile playbackSpeed={speed} onChange={setSpeed} />;
}

describe('PlaybackSpeedControl', () => {
  it('uses one touch-safe mobile chip and cycles the exact supported speeds', () => {
    render(<MobileHarness />);

    const names = [
      'Playback speed 1×. Tap to cycle speed.',
      'Playback speed 2×. Tap to cycle speed.',
      'Playback speed 4×. Tap to cycle speed.',
      'Playback speed 0.25×. Tap to cycle speed.',
      'Playback speed 0.5×. Tap to cycle speed.',
      'Playback speed 1×. Tap to cycle speed.',
    ];

    let chip = screen.getByTestId('mobile-playback-speed');
    expect(chip.getAttribute('aria-label')).toBe(names[0]);
    expect(chip.style.touchAction).toBe('manipulation');
    expect(screen.getAllByRole('button')).toHaveLength(1);

    for (const name of names.slice(1)) {
      fireEvent.click(chip);
      chip = screen.getByTestId('mobile-playback-speed');
      expect(chip.getAttribute('aria-label')).toBe(name);
    }
  });

  it('retains all five individually labelled speed buttons on desktop', () => {
    const onChange = vi.fn();
    render(<PlaybackSpeedControl isMobile={false} playbackSpeed={1} onChange={onChange} />);

    const group = screen.getByTestId('desktop-playback-speeds');
    expect(group.querySelectorAll('button')).toHaveLength(5);
    for (const speed of [0.25, 0.5, 1, 2, 4]) {
      expect(screen.getByRole('button', { name: `Set playback speed ${speed}×` })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Set playback speed 1×' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Set playback speed 2×' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });
});
