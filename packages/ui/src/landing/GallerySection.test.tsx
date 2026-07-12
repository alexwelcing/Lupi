import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStore } from '../test-utils';
import { GallerySection } from './GallerySection';

vi.mock('../Gallery', () => ({
  Gallery: ({ initialDomain }: { initialDomain?: string }) => (
    <div data-testid="curated-gallery" data-domain={initialDomain} />
  ),
}));

vi.mock('../molecules/MoleculeBrowser', () => ({
  MoleculeBrowser: ({ initialQuery }: { initialQuery?: string }) => (
    <div data-testid="federated-search" data-query={initialQuery} />
  ),
}));

vi.mock('../panels/PotentialBrowser', () => ({
  PotentialBrowser: () => <div data-testid="potential-browser" />,
}));

vi.mock('../EquilibriumSolveWorkbench', () => ({
  EquilibriumSolveWorkbench: () => <div data-testid="equilibrium-workbench" />,
}));

describe('GallerySection homepage intent handoff', () => {
  beforeEach(() => resetStore());

  it('routes unmatched search to all sources and field choices back to filtered examples', () => {
    render(<GallerySection />);
    expect(screen.getByTestId('curated-gallery').getAttribute('data-domain')).toBe('All');

    act(() => {
      window.dispatchEvent(new CustomEvent('lupi:gallery-search', { detail: 'unobtainium' }));
    });
    const firstSearch = screen.getByTestId('federated-search');
    expect(firstSearch.getAttribute('data-query')).toBe('unobtainium');

    act(() => {
      window.dispatchEvent(new CustomEvent('lupi:gallery-search', { detail: 'unobtainium' }));
    });
    expect(screen.getByTestId('federated-search')).not.toBe(firstSearch);

    act(() => {
      window.dispatchEvent(new CustomEvent('lupi:gallery-domain', { detail: 'Energy Materials' }));
    });
    expect(screen.getByTestId('curated-gallery').getAttribute('data-domain')).toBe('Energy Materials');
  });
});
