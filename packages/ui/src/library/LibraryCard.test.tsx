import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoleculeHit } from '../molecules/types';
import { LibraryCard, describeHitTruth, provenanceLine } from './LibraryCard';

afterEach(cleanup);

const research: MoleculeHit = {
  id: 'plga',
  source: 'research',
  title: 'Semi-crystalline PLGA at 400 K',
  subtitle: '5,000 beads · snapshot',
  elements: undefined,
  load: { kind: 'url', url: '/v1/datasets/research/plga/files/plga_cryst_400K.dump' },
  notice: 'Coarse-grained beads are shown as spheres.',
  provenance: {
    sourceUrl: 'https://zenodo.org/records/13905472',
    doi: '10.5281/zenodo.13905472',
    citation: 'Example citation',
    license: 'CC-BY-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
};

describe('describeHitTruth', () => {
  it('never claims bonds for OMol25 and distinguishes NIST demos from procedural crystals', () => {
    expect(describeHitTruth({ id: '1', source: 'omol', title: 'C6H6', load: { kind: 'url', url: '/x.xyz' } })).toMatch(/no bonds/i);
    expect(describeHitTruth({ id: '2', source: 'nist', title: 'Cu', load: { kind: 'url', url: '/nist/demo.lammpstrj' } })).toMatch(/demo trajectory/i);
    expect(
      describeHitTruth({ id: '3', source: 'nist', title: 'Cu', load: { kind: 'generate', inputType: 'procedural', input: 'Cu fcc' } }),
    ).toMatch(/not NIST data/i);
    expect(describeHitTruth({ ...research, load: { ...research.load, atomTypeMap: { 1: 6 } } as MoleculeHit['load'] })).toMatch(/element map/i);
    expect(describeHitTruth(research)).toMatch(/opaque/i);
  });
});

describe('LibraryCard', () => {
  it('renders provenance from the hit and nothing invented', () => {
    const onOpen = vi.fn();
    render(<LibraryCard hit={research} busy={false} onOpen={onOpen} />);
    expect(provenanceLine(research)).toBe('zenodo.org · 10.5281/zenodo.13905472 · CC-BY-4.0');
    expect(screen.getByText('zenodo.org · 10.5281/zenodo.13905472 · CC-BY-4.0')).toBeTruthy();
    expect(screen.getByText('Coarse-grained beads are shown as spheres.')).toBeTruthy();
    expect(screen.getByText('Zenodo research')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Semi-crystalline PLGA at 400 K' }));
    expect(onOpen).toHaveBeenCalledWith(research);
  });
  it('omits the provenance line and disables the button while busy', () => {
    const hit: MoleculeHit = { id: 'w', source: 'gallery', title: 'Water', elements: ['H', 'O'], load: { kind: 'url', url: '/w.xyz' } };
    render(<LibraryCard hit={hit} busy onOpen={() => undefined} activeElements={['O']} />);
    const button = screen.getByRole('button', { name: 'Open Water' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByText(/zenodo/)).toBeNull();
    expect(screen.getByText('O').className).toBe('is-active');
  });
});
