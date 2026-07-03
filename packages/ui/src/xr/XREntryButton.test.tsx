import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { XREntryButton } from './XREntryButton';

function stubNavigatorXR(supported: Partial<Record<string, boolean>> | null) {
  Object.defineProperty(navigator, 'xr', {
    configurable: true,
    value: supported === null
      ? undefined
      : { isSessionSupported: vi.fn(async (mode: string) => !!supported[mode]) },
  });
}

describe('XREntryButton', () => {
  afterEach(() => {
    cleanup();
    stubNavigatorXR(null);
  });

  it('renders nothing when WebXR is unavailable', async () => {
    stubNavigatorXR(null);
    const store = { enterAR: vi.fn(), enterVR: vi.fn() };
    const { container } = render(<XREntryButton store={store} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders only the supported immersive modes', async () => {
    stubNavigatorXR({ 'immersive-ar': true, 'immersive-vr': false });
    const store = { enterAR: vi.fn(), enterVR: vi.fn() };
    render(<XREntryButton store={store} />);

    const arButton = await screen.findByText('View in AR');
    expect(arButton).toBeDefined();
    expect(screen.queryByText('Enter VR')).toBeNull();
  });

  it('wires the buttons to the store entry points', async () => {
    stubNavigatorXR({ 'immersive-ar': true, 'immersive-vr': true });
    const store = { enterAR: vi.fn(), enterVR: vi.fn() };
    render(<XREntryButton store={store} />);

    fireEvent.click(await screen.findByText('View in AR'));
    fireEvent.click(await screen.findByText('Enter VR'));
    expect(store.enterAR).toHaveBeenCalledTimes(1);
    expect(store.enterVR).toHaveBeenCalledTimes(1);
  });
});
