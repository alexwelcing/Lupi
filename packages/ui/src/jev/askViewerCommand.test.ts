import { afterEach, describe, expect, it, vi } from 'vitest';
import { askViewerCommand, resetAskAvailability } from './askViewerCommand';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  resetAskAvailability();
});

describe('askViewerCommand', () => {
  it('skips short text without a request', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    expect(await askViewerCommand('hi')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('labels a decision from the edge and keeps the code-owned command', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({
      configured: true,
      model: 'jev-1.13.0',
      decision: { action: 'top', command: { tool: 'lupi.set_camera_preset', arguments: { preset: 'top' } }, confidence: 0.97, source: 'jev' },
    })));
    expect(await askViewerCommand('look at it from above')).toEqual({
      action: 'top',
      label: 'Camera top view',
      command: { tool: 'lupi.set_camera_preset', arguments: { preset: 'top' } },
      confidence: 0.97,
      source: 'jev',
      model: 'jev-1.13.0',
    });
  });

  it('returns nothing for withheld decisions, unknown actions, and failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ configured: true, decision: { action: null, reason: 'uncertain', source: 'jev' } })));
    expect(await askViewerCommand('maybe pause?')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ configured: true, decision: { action: 'delete_all', command: { tool: 'x', arguments: {} }, source: 'jev' } })));
    expect(await askViewerCommand('delete everything')).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'boom' }, 500)));
    expect(await askViewerCommand('look from the side')).toBeNull();
  });

  it('stops asking for the session once the edge says it is not configured, but still takes local literals', async () => {
    const fetcher = vi.fn(async () => reply({ configured: false }));
    vi.stubGlobal('fetch', fetcher);
    expect(await askViewerCommand('look from the side')).toBeNull();
    expect(await askViewerCommand('look from the front')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
    resetAskAvailability();
    vi.stubGlobal('fetch', vi.fn(async () => reply({ configured: false, decision: { action: 'pause', command: { tool: 'lupi.pause', arguments: {} }, confidence: 1, source: 'local' } })));
    expect((await askViewerCommand('pause'))?.source).toBe('local');
  });
});
