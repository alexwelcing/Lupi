import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MelancholiaLanding } from './MelancholiaLanding';
import { openMolecule } from '../../viewer/openMolecule';

vi.mock('./MatterPlanet', () => ({
  MatterPlanet: () => <div data-testid="matter-planet" />,
}));

vi.mock('./MatterField', () => ({
  MatterField: ({ className }: { className?: string }) => <div data-testid="matter-field" className={className} />,
}));

vi.mock('../../viewer/openMolecule', () => ({
  openMolecule: vi.fn(async () => undefined),
}));

describe('MelancholiaLanding task-first entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    globalThis.IntersectionObserver = class IntersectionObserver {
      constructor(_callback: IntersectionObserverCallback) {}
      observe() {}
      unobserve() {}
      disconnect() {}
      root = null;
      rootMargin = '';
      thresholds = [];
      takeRecords() { return []; }
    };
  });

  it('states the product clearly and exposes direct entry paths', () => {
    render(<MelancholiaLanding />);

    expect(screen.getByRole('heading', { level: 1, name: 'Explore matter in 3D.' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search molecules and materials' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Caffeine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open your data' })).toBeTruthy();
  }, 10_000);

  it('turns a homepage search match into a one-click live structure', () => {
    render(<MelancholiaLanding />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search molecules and materials' }), {
      target: { value: 'caffeine' },
    });

    const results = screen.getByRole('region', { name: 'Matching examples' });
    fireEvent.click(within(results).getByRole('button', { name: /^Caffeine/ }));

    expect(openMolecule).toHaveBeenCalledWith({ kind: 'gallery', id: 'caffeine', history: 'push' });
  });

  it('hands an unmatched query to the full library instead of opening an unrelated example', () => {
    const handleSearch = vi.fn();
    window.addEventListener('lupi:gallery-search', handleSearch);
    render(<MelancholiaLanding />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search molecules and materials' }), {
      target: { value: 'unobtainium' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(openMolecule).not.toHaveBeenCalled();
    expect(handleSearch).toHaveBeenCalledOnce();
    expect((handleSearch.mock.calls[0][0] as CustomEvent<string>).detail).toBe('unobtainium');
    window.removeEventListener('lupi:gallery-search', handleSearch);
  });

  it('searches broad partial text instead of silently opening the first suggestion', () => {
    const handleSearch = vi.fn();
    window.addEventListener('lupi:gallery-search', handleSearch);
    render(<MelancholiaLanding />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search molecules and materials' }), {
      target: { value: 'caff' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(openMolecule).not.toHaveBeenCalled();
    expect((handleSearch.mock.calls[0][0] as CustomEvent<string>).detail).toBe('caff');
    window.removeEventListener('lupi:gallery-search', handleSearch);
  });
});
