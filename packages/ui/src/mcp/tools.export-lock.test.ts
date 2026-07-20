// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../store';
import { runStoreExport } from './tools';

afterEach(() => {
  vi.useRealTimers();
  useStore.getState().clearExportRequest();
});

describe('MCP export request ownership', () => {
  it('removes an unclaimed request when no mounted exporter starts it', async () => {
    vi.useFakeTimers();
    const pending = runStoreExport({ type: 'image', format: 'png' }, 1_000);
    const rejection = expect(pending).rejects.toThrow('Timed out waiting for viewer export');

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(useStore.getState().exportRequest.type).toBeNull();
  });

  it('retains the lock after timeout while an async encoder still owns it', async () => {
    vi.useFakeTimers();
    const pending = runStoreExport({ type: 'usdz', format: 'usdz' }, 1_000);
    const ownedRequest = useStore.getState().exportRequest;
    ownedRequest.onStart?.();
    const rejection = expect(pending).rejects.toThrow('Timed out waiting for viewer export');

    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    expect(useStore.getState().exportRequest).toBe(ownedRequest);
    // A late encoder callback is ignored by the timed-out promise; the mounted
    // ExportManager remains responsible for clearing its own request in finally.
    ownedRequest.onComplete?.(false);
    expect(useStore.getState().exportRequest).toBe(ownedRequest);
  });
});
