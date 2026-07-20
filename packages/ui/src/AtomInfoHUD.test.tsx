import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFrame } from '@atlas/core/test-utils';
import { AtomInfoHUD } from './AtomInfoHUD';
import { resetStore } from './test-utils';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('AtomInfoHUD chemistry truth', () => {
  beforeEach(() => resetStore());
  afterEach(() => cleanup());

  it('shows opaque raw types without element roles or Ångström labels', () => {
    const frame = createMockFrame({ natoms: 1, types: [6] });
    frame.typeSemantics = { kind: 'opaque', provenance: 'legacy-unknown' };
    frame.distanceSemantics = { kind: 'unknown', provenance: 'legacy-unknown' };

    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);

    expect(screen.getByText('Type 6')).toBeTruthy();
    expect(screen.queryByText('Framework')).toBeNull();
    expect(screen.getByText(/source units$/)).toBeTruthy();
  });

  it('shows mapped element identity and Ångström units when both are declared', () => {
    const frame = createMockFrame({ natoms: 1, types: [6] });
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };

    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);

    expect(screen.getByText('Carbon')).toBeTruthy();
    expect(screen.getByText('Framework')).toBeTruthy();
    expect(screen.getByText(/Å$/)).toBeTruthy();
  });
});
