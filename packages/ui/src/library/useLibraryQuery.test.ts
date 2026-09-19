import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_LIBRARY_QUERY, parseLibraryQuery, serializeLibraryQuery, useLibraryQuery } from './useLibraryQuery';

describe('library query serialization', () => {
  it('round-trips every parameter and drops empty ones', () => {
    const query = { q: 'benzene', source: 'omol', elements: ['C', 'H'], collection: 'neutral-train', offset: 48, view: 'facets' };
    expect(parseLibraryQuery(`?${serializeLibraryQuery(query)}`)).toEqual(query);
    expect(serializeLibraryQuery(EMPTY_LIBRARY_QUERY)).toBe('');
    expect(parseLibraryQuery('?offset=-4&elements=,,&q=%20')).toEqual(EMPTY_LIBRARY_QUERY);
  });
});

describe('useLibraryQuery', () => {
  it('writes to the URL with replaceState and re-reads on popstate', () => {
    window.history.replaceState({}, '', '/library');
    const { result } = renderHook(() => useLibraryQuery());
    expect(result.current[0]).toEqual(EMPTY_LIBRARY_QUERY);
    act(() => result.current[1]({ q: 'water', elements: ['O'] }));
    expect(window.location.search).toBe('?q=water&elements=O');
    expect(result.current[0].q).toBe('water');
    act(() => {
      window.history.replaceState({}, '', '/library?q=ethanol');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current[0].q).toBe('ethanol');
    expect(result.current[0].elements).toEqual([]);
  });
});
