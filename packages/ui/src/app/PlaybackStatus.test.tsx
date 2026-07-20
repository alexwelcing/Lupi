import { createMockTrajectory } from '@atlas/core/test-utils';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { PlaybackStatus } from './PlaybackStatus';

function loadTrajectory(frameCount = 3) {
  useStore.getState().setFile({
    name: 'trajectory.lammpstrj',
    size: 128,
    trajectory: createMockTrajectory(frameCount, 2),
    thermo: null,
  });
}

describe('PlaybackStatus', () => {
  beforeEach(() => resetStore());

  it('keeps the frame overlay on desktop for a fully buffered trajectory', () => {
    loadTrajectory();
    render(<PlaybackStatus frame={0} totalFrames={3} />);

    expect(screen.getByTestId('playback-status').textContent).toMatch(/Frame\s*1 \/ 3/);
    expect(screen.queryByTestId('streaming-frame-status')).toBeNull();
  });

  it('renders no empty overlay on mobile when the trajectory is fully buffered', () => {
    loadTrajectory();
    render(<PlaybackStatus frame={0} totalFrames={3} showFrame={false} />);

    expect(screen.queryByTestId('playback-status')).toBeNull();
  });

  it('keeps streaming state visible on mobile without duplicating the frame readout', () => {
    const trajectory = createMockTrajectory(3, 2);
    trajectory.frames[1] = undefined as never;
    useStore.getState().setFile({
      name: 'streaming.lammpstrj',
      size: 128,
      trajectory,
      thermo: null,
    });
    useStore.getState().setFrame(1);

    render(<PlaybackStatus frame={1} totalFrames={3} showFrame={false} />);

    const status = screen.getByTestId('streaming-frame-status');
    expect(status.textContent).toMatch(/Buffering\s*2\/3/);
    expect(screen.getByTestId('playback-status').textContent).not.toContain('Frame');
  });
});
