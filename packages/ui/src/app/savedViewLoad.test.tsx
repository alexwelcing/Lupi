import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { getStoreState, resetStore } from '../test-utils';
import { useSavedViewQuerySync } from './useSavedViewQuerySync';
import { loadSavedMolecularView, type SavedMolecularView } from '../savedViews';

vi.mock('../savedViews', () => ({ loadSavedMolecularView: vi.fn() }));
const mockedLoad = vi.mocked(loadSavedMolecularView);

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useSavedViewQuerySync', () => {
  beforeEach(() => {
    resetStore();
    mockedLoad.mockReset();
    document.title = '';
  });

  it('loads a valid slug and clears loading', async () => {
    mockedLoad.mockResolvedValueOnce({ title: 'My Molecule' } as SavedMolecularView);
    const { result } = renderHook(() => useSavedViewQuerySync('my-molecule'), { wrapper: wrapper() });
    expect(getStoreState().loading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getStoreState().loading).toBe(false);
    expect(getStoreState().error).toBeNull();
    expect(document.title).toBe('My Molecule - Lupi');
  });

  it('preserves the anchored missing-view error contract for visible classification', async () => {
    mockedLoad.mockRejectedValueOnce(new Error('No Lupi view found for "missing-slug".'));
    const { result } = renderHook(() => useSavedViewQuerySync('missing-slug'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getStoreState().loading).toBe(false);
    expect(getStoreState().error).toBe('No Lupi view found for "missing-slug".');
  });

  it('preserves the permission error object while mirroring a safe store message', async () => {
    const denied = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
    mockedLoad.mockRejectedValueOnce(denied);
    const { result } = renderHook(() => useSavedViewQuerySync('private-slug'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(denied);
    expect(getStoreState().loading).toBe(false);
    expect(getStoreState().error).toBe('Lupi was not permitted to read this saved view.');
  });

  it('does nothing without a slug', async () => {
    const { result } = renderHook(() => useSavedViewQuerySync(null), { wrapper: wrapper() });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockedLoad).not.toHaveBeenCalled();
    expect(getStoreState().loading).toBe(false);
    expect(getStoreState().error).toBeNull();
  });

  it('does not mirror a raw generic provider error into the global store', async () => {
    mockedLoad.mockRejectedValueOnce(new Error('Firebase project secret-project-123 token=abcdef'));
    const { result } = renderHook(() => useSavedViewQuerySync('broken'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getStoreState().error).toBe('This saved Lupi view could not be loaded.');
    expect(getStoreState().error).not.toMatch(/secret-project|abcdef/i);
  });

  it('re-enters loading and clears the previous error on an explicit retry', async () => {
    let resolveRetry!: (view: SavedMolecularView) => void;
    mockedLoad
      .mockRejectedValueOnce(new Error('No Lupi view found for "retry-view".'))
      .mockImplementationOnce(() => new Promise(resolve => { resolveRetry = resolve; }));
    const { result } = renderHook(() => useSavedViewQuerySync('retry-view'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    void result.current.refetch();
    await waitFor(() => expect(getStoreState().loading).toBe(true));
    expect(getStoreState().error).toBeNull();
    resolveRetry({ title: 'Recovered' } as SavedMolecularView);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getStoreState().loading).toBe(false);
  });
});
