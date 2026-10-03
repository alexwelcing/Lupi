import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../store';
import { useOmolOpener } from './OmolShelf';
import { OMOL_PICK_FAILURE } from './omolPicks';

describe('useOmolOpener', () => {
  beforeEach(() => useStore.getState().setError(null));

  it("shows the surface's sentence as the one alert, clearing the loader's raw message from the store", async () => {
    const { result } = renderHook(() => useOmolOpener());
    act(() => {
      result.current.run('pick', OMOL_PICK_FAILURE, async () => {
        useStore.getState().setError('Failed to fetch');
        return { ok: false, message: 'Failed to fetch' };
      });
    });
    await waitFor(() => expect(result.current.failure).toBe(OMOL_PICK_FAILURE));
    expect(useStore.getState().error).toBeNull();
    expect(result.current.opening).toBeNull();
  });

  it("leaves another load's error alone, and a superseded open is no failure", async () => {
    useStore.getState().setError('Something else failed');
    const { result } = renderHook(() => useOmolOpener());
    act(() => {
      result.current.run('pick', OMOL_PICK_FAILURE, async () => ({
        ok: false,
        message: 'Viewer load was superseded by newer navigation.',
      }));
    });
    await waitFor(() => expect(result.current.opening).toBeNull());
    expect(result.current.failure).toBeNull();
    expect(useStore.getState().error).toBe('Something else failed');
  });
});
