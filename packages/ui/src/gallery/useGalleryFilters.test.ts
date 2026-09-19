import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './catalog';
import { useGalleryFilters } from './useGalleryFilters';

describe('useGalleryFilters', () => {
  it('starts with the whole catalog and composes domain, type, group, and text filters', () => {
    const { result } = renderHook(() => useGalleryFilters('All'));
    expect(result.current.filteredExamples).toHaveLength(EXAMPLES.length);
    act(() => result.current.setFilter('Biomolecules'));
    const biomolecules = result.current.filteredExamples.length;
    expect(biomolecules).toBeGreaterThan(0);
    expect(biomolecules).toBeLessThan(EXAMPLES.length);
    act(() => result.current.setSearch('caffeine'));
    expect(result.current.filteredExamples.map((ex) => ex.id)).toContain('caffeine');
    act(() => result.current.setSourceFilter('Trajectories'));
    expect(result.current.filteredExamples).toHaveLength(0);
    act(() => result.current.clearFilters());
    expect(result.current.filteredExamples).toHaveLength(EXAMPLES.length);
    expect(result.current.domainSummaries.every((summary) => summary.count > 0)).toBe(true);
  });
});
