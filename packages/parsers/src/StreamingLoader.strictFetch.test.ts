import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingLoader } from './StreamingLoader';

describe('StreamingLoader strict fetch mode', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('makes a redirect failure on HEAD terminal without a second request', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed: redirect mode is set to error'));
    const loader = new StreamingLoader(
      'https://lupi.live/gallery/trajectory.glimbin',
      {},
      20,
      { redirect: 'error' },
    );
    await expect(loader.fetchHeader()).rejects.toThrow(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://lupi.live/gallery/trajectory.glimbin',
      { method: 'HEAD', redirect: 'error' },
    );
  });

  it('applies redirect:error to both HEAD and range requests', async () => {
    fetchMock
      .mockResolvedValueOnce({
        redirected: false,
        headers: { get: () => '1024' },
      })
      .mockRejectedValueOnce(new TypeError('range request failed'));
    const loader = new StreamingLoader(
      'https://lupi.live/gallery/trajectory.glimbin',
      {},
      20,
      { redirect: 'error' },
    );
    await expect(loader.fetchHeader()).rejects.toThrow(/range request failed/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      redirect: 'error',
      headers: { Range: 'bytes=0-255' },
    });
  });
});
