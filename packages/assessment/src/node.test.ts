import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assessAsset, assessMany } from './index';
import { byteSourceFromPath, byteSourcesFromPath } from './node';

describe('Node path adapters and CLI fixture', () => {
  it('assesses a local fixture and includes the sampled fingerprint in its cache identity', async () => {
    const source = await byteSourceFromPath(path.resolve('fixtures/water.xyz'));
    expect(source.cacheKey).toContain('unsampled');
    const assessed = await assessAsset(source);
    expect(assessed.report).toMatchObject({
      input: { name: 'water.xyz' },
      inspection: { inspectorId: 'xyz-head-v1' },
      observations: { format: 'xyz', atomCount: 3 },
    });
    expect(source.cacheKey).not.toContain('unsampled');
  });

  it('expands directories in deterministic lexical order', async () => {
    const sources = await byteSourcesFromPath(path.resolve('fixtures'));
    expect(sources.map((source) => source.name)).toEqual(['water.xyz']);
  });

  it('keeps a cold 100-file local fast run under the reference budget', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'lupi-assessment-'));
    const fixture = '3\nwater\nO 0 0 0\nH 1 0 0\nH 0 1 0\n';
    try {
      await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(path.join(directory, `${String(index).padStart(3, '0')}.xyz`), fixture)));
      const started = performance.now();
      const sources = await byteSourcesFromPath(directory);
      const batch = await assessMany(sources);
      const durationMs = performance.now() - started;
      expect(batch.results).toHaveLength(100);
      expect(batch.failures).toHaveLength(0);
      expect(batch.results.reduce((sum, result) => sum + result.execution.bytesRead, 0)).toBeLessThanOrEqual(100 * 128 * 1024);
      expect(durationMs).toBeLessThan(3_000);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
