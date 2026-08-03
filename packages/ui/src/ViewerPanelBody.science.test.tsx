import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { useStore } from './store';
import { resetStore } from './test-utils';
import { ViewerPanelBody } from './ViewerPanelBody';
import { scienceBundleForPathIndex } from './science/scienceBundle';

/**
 * The heart of the integration: the viewer frame and the panel's selected
 * NEB image are the same zero-based number, in both directions.
 */
describe('ViewerPanelBody science frame ↔ image sync', () => {
  beforeEach(() => {
    resetStore();
    const bundle = scienceBundleForPathIndex(16)!;
    useStore.getState().setFile({
      name: 'z1-path-16.extxyz',
      size: 10315,
      trajectory: createMockTrajectory(bundle.path.imageCount, 51),
      thermo: null,
      science: bundle,
    });
  });

  it('renders the store frame as the selected zero-based NEB image', () => {
    useStore.getState().setFrame(2);
    render(<ViewerPanelBody activePanel="science" studioDeck={null} />);

    // Zero-based: image 2 of 4 (5 images), never "FRAME 3/5".
    expect(screen.getByText(/NEB image 2 of 4/)).toBeTruthy();
    const panel = screen.getByTestId('science-path-panel');
    expect(panel.getAttribute('data-path-index')).toBe('16');
    expect(panel.getAttribute('data-variant')).toBe('deck');
    expect(panel.getAttribute('data-bundle-status')).toBe('active');
    expect(panel.getAttribute('data-bundle-quality')).toBe('verified');
    expect(screen.getByText(/manifest: sha256:8fa964dffe3742df/)).toBeTruthy();
  });

  it('surfaces the loaded run provenance and supersedes chain in the panel chrome', () => {
    const bundle = scienceBundleForPathIndex(16)!;
    render(<ViewerPanelBody activePanel="science" studioDeck={null} />);

    const provenance = screen.getByTestId('science-run-provenance');
    expect(provenance.textContent).toContain(`Source campaign: ${bundle.path.revision.campaignId}`);
    expect(provenance.textContent).toContain(`Run id: ${bundle.path.revision.runId}`);
    expect(provenance.textContent).toContain(`Bundle digest: ${bundle.path.revision.bundleId}`);
    expect(provenance.textContent).toContain('Supersedes chain: none');
  });

  it('writes panel image selection back to the store frame', () => {
    useStore.getState().setFrame(0);
    render(<ViewerPanelBody activePanel="science" studioDeck={null} />);

    fireEvent.click(screen.getByText('next image →'));
    expect(useStore.getState().frame).toBe(1);
    expect(screen.getByText(/NEB image 1 of 4/)).toBeTruthy();

    fireEvent.click(screen.getByText('← previous image'));
    expect(useStore.getState().frame).toBe(0);
  });

  it('moves the scene frame when a plot is clicked', () => {
    useStore.getState().setFrame(4);
    render(<ViewerPanelBody activePanel="science" studioDeck={null} />);

    // jsdom rects are zero-sized, so a mousemove at (0,0) resolves to image 0.
    const plot = screen.getByTestId('science-t1-panel').querySelector('svg')!;
    fireEvent.mouseMove(plot, { clientX: 0, clientY: 0 });
    fireEvent.click(plot, { clientX: 0, clientY: 0 });
    expect(useStore.getState().frame).toBe(0);
  });

  it('clamps an out-of-range store frame to the last NEB image', () => {
    // Frame beyond imageCount - 1 must display clamped, never a 1-based lie.
    useStore.setState({ frame: 9 });
    render(<ViewerPanelBody activePanel="science" studioDeck={null} />);
    expect(screen.getByText(/NEB image 4 of 4/)).toBeTruthy();
  });

  it('renders nothing when the loaded file carries no science bundle', () => {
    useStore.getState().setFile({
      name: 'water.xyz',
      size: 128,
      trajectory: createMockTrajectory(3, 3),
      thermo: null,
    });
    const { container } = render(<ViewerPanelBody activePanel="science" studioDeck={null} />);
    expect(container.firstChild).toBeNull();
  });
});
