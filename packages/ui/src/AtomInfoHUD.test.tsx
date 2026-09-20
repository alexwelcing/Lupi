import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockFrame } from '@atlas/core/test-utils';
import { AtomInfoHUD } from './AtomInfoHUD';
import { resetStore } from './test-utils';

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('AtomInfoHUD chemistry truth', () => {
  beforeEach(() => resetStore());
  afterEach(() => {
    cleanup();
    // @ts-expect-error jsdom has no matchMedia; restore the "no match" default.
    delete window.matchMedia;
  });

  it('shows opaque raw types without element roles or Ångström labels', () => {
    const frame = createMockFrame({ natoms: 1, types: [6] });
    frame.typeSemantics = { kind: 'opaque', provenance: 'legacy-unknown' };
    frame.distanceSemantics = { kind: 'unknown', provenance: 'legacy-unknown' };

    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);

    expect(screen.getByText('Type 6')).toBeTruthy();
    expect(screen.queryByText('Framework')).toBeNull();
    expect(screen.queryByText('Mass')).toBeNull();
    expect(screen.getByText(/source units$/)).toBeTruthy();
  });

  it('shows mapped element identity and Ångström units when both are declared', () => {
    const frame = createMockFrame({ natoms: 1, types: [6] });
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };

    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);

    expect(screen.getByText('Carbon')).toBeTruthy();
    expect(screen.getByText('Framework')).toBeTruthy();
    // Å-suffixed cells: the covalent radius tile and the position section title.
    expect(screen.getAllByText(/Å$/).length).toBeGreaterThan(0);
  });

  it('lays element facts out as labelled tiles instead of packed rows', () => {
    const frame = createMockFrame({ natoms: 1, types: [8] });
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
    frame.positions.set([7.2, -1.25, -0.001], 0);

    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);

    expect(screen.getByText('Oxygen')).toBeTruthy();
    expect(screen.getByText('Mass')).toBeTruthy();
    expect(screen.getByText('15.999 u')).toBeTruthy();
    expect(screen.getByText('Cov. radius')).toBeTruthy();
    expect(screen.getByText('0.66 Å')).toBeTruthy();
    expect(screen.getByText('χ')).toBeTruthy();
    expect(screen.getByText('3.44')).toBeTruthy();
    expect(screen.getByText('Group')).toBeTruthy();
    expect(screen.getByText('16')).toBeTruthy();
    // Category and role read as a subtitle, not as tiles.
    expect(screen.getByText('Nonmetal')).toBeTruthy();
    expect(screen.getByText('Framework')).toBeTruthy();
    expect(screen.queryByText('Role')).toBeNull();
    // Coordinates get their own cells: typographic minus, no "-0.00".
    expect(screen.getByText('Position · Å')).toBeTruthy();
    expect(screen.getByText('7.20')).toBeTruthy();
    expect(screen.getByText('−1.25')).toBeTruthy();
    expect(screen.getByText('0.00')).toBeTruthy();
    // Identity chips replace the "atom #4 / id 5 / type 8" run-on line.
    expect(screen.getByText('atom 0')).toBeTruthy();
    expect(screen.getByText('type 8')).toBeTruthy();
  });

  it('anchors to the atom on desktop and docks as a sheet on phones', () => {
    const frame = createMockFrame({ natoms: 1, types: [6] });

    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);
    expect(screen.getByTestId('atom-info-card').getAttribute('data-layout')).toBe('anchored');
    cleanup();

    stubMatchMedia(true);
    render(<AtomInfoHUD frame={frame} selectedAtoms={[0]} />);
    expect(screen.getByTestId('atom-info-card').getAttribute('data-layout')).toBe('sheet');
  });

  it('dismisses through an accessible close button', () => {
    const frame = createMockFrame({ natoms: 2, types: [6, 8] });
    const onDismissCard = vi.fn();

    render(<AtomInfoHUD frame={frame} selectedAtoms={[1]} onDismissCard={onDismissCard} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss atom details' }));

    expect(onDismissCard).toHaveBeenCalledWith(1);
  });
});
