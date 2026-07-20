import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFrame } from '@atlas/core/test-utils';
import { useStore } from '../store';
import { resetStore } from '../test-utils';
import { FigureExportPanel } from './FigureExportPanel';

function loadFrame(chemical: boolean) {
  const frame = createMockFrame({ natoms: 2, types: [6, 1] });
  frame.typeSemantics = chemical
    ? { kind: 'atomic-number', provenance: 'source-element-symbol' }
    : { kind: 'opaque', provenance: 'legacy-unknown' };
  frame.distanceSemantics = chemical
    ? { kind: 'angstrom', provenance: 'format-convention' }
    : { kind: 'unknown', provenance: 'legacy-unknown' };
  useStore.getState().setFile({
    name: chemical ? 'chemical.xyz' : 'opaque.dump',
    size: 32,
    trajectory: {
      frames: [frame],
      totalFrames: 1,
      atomTypes: [1, 6],
      globalBounds: { min: [0, 0, 0], max: [1, 1, 1] },
    },
    thermo: null,
  });
}

describe('FigureExportPanel chemistry summary', () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows a formula only for completely mapped element types', () => {
    loadFrame(true);
    const { container } = render(<FigureExportPanel showCloseButton={false} />);
    expect(container.textContent).toContain('CH / 2 atoms / frame 1');
  });

  it('uses the file label instead of inventing a formula for opaque types', () => {
    loadFrame(false);
    const { container } = render(<FigureExportPanel showCloseButton={false} />);
    expect(container.textContent).toContain('opaque.dump / 2 atoms / frame 1');
    expect(container.textContent).not.toContain('CH / 2 atoms');
  });
});
