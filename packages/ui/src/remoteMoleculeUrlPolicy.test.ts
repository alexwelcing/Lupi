import { describe, expect, it } from 'vitest';
import { assertAllowedRemoteMoleculeUrl } from './remoteMoleculeUrlPolicy';

const ORIGIN = 'https://lupi.live';

describe('assertAllowedRemoteMoleculeUrl', () => {
  it.each([
    'https://lupi.live/gallery/curated/caffeine.xyz',
    'https://www.lupi.live/gallery/a/sample.glimbin',
    'https://storage.googleapis.com/shed-489901-nist-demos/sample.dump',
    'https://storage.googleapis.com/shed-489901-omol25/nested/sample.extxyz?alt=media',
  ])('accepts audited absolute source %s', (url) => {
    expect(assertAllowedRemoteMoleculeUrl(url, 'mcp', ORIGIN).absoluteUrl).toBe(url);
  });

  it('accepts a normalized same-origin gallery path for human and saved-view loads', () => {
    const result = assertAllowedRemoteMoleculeUrl('/gallery/curated/./caffeine.xyz?download=1', 'human-load', 'https://preview.example.workers.dev');
    expect(result).toMatchObject({
      url: '/gallery/curated/caffeine.xyz?download=1',
      absoluteUrl: 'https://preview.example.workers.dev/gallery/curated/caffeine.xyz?download=1',
      sameOriginStrict: true,
    });
    expect(() => assertAllowedRemoteMoleculeUrl('/gallery/caffeine.xyz', 'mcp', ORIGIN)).toThrow(/absolute HTTPS/i);
  });

  it('accepts a root-relative gallery path from a local HTTP preview origin', () => {
    expect(assertAllowedRemoteMoleculeUrl(
      '/gallery/curated/caffeine.xyz',
      'human-load',
      'http://127.0.0.1:4173',
    )).toMatchObject({
      url: '/gallery/curated/caffeine.xyz',
      absoluteUrl: 'http://127.0.0.1:4173/gallery/curated/caffeine.xyz',
      sameOriginStrict: true,
    });
  });

  it('accepts the generated sphere-grid gallery asset from the same origin', () => {
    expect(assertAllowedRemoteMoleculeUrl(
      '/generated/lupine-wiki/sphere-grid.lammpstrj',
      'human-load',
      'http://localhost:3000',
    )).toMatchObject({
      url: '/generated/lupine-wiki/sphere-grid.lammpstrj',
      sameOriginStrict: true,
    });
  });

  it('accepts an absolute loopback molecule URL only for an interactive local build', () => {
    const url = 'http://127.0.0.1:8787/v1/datasets/research/gst-phase-change-ace-start/files/GST_config.data';
    expect(assertAllowedRemoteMoleculeUrl(
      url,
      'human-load',
      'http://localhost:5177',
    )).toEqual({
      url,
      absoluteUrl: url,
      sameOriginStrict: false,
    });

    expect(() => assertAllowedRemoteMoleculeUrl(url, 'human-load', ORIGIN)).toThrow();
    expect(() => assertAllowedRemoteMoleculeUrl(url, 'saved-view', 'http://localhost:5177')).toThrow();
    expect(() => assertAllowedRemoteMoleculeUrl(url, 'mcp', 'http://localhost:5177')).toThrow(/HTTPS/i);
  });

  it.each([
    '/v1/datasets/omol25/neutral-train/structures/34335827.xyz',
    '/v1/datasets/research/gst-phase-change-ace-start/files/GST_config.data',
  ])('accepts an exact same-origin scientific catalog asset %s', (url) => {
    expect(assertAllowedRemoteMoleculeUrl(url, 'human-load', 'http://127.0.0.1:5177')).toMatchObject({
      url,
      sameOriginStrict: true,
    });
  });

  it.each([
    'http://lupi.live/gallery/a.xyz',
    'https://user:pass@lupi.live/gallery/a.xyz',
    'https://lupi.live:8443/gallery/a.xyz',
    'https://127.0.0.1/gallery/a.xyz',
    'https://169.254.169.254/gallery/a.xyz',
    'https://10.0.0.1/gallery/a.xyz',
    'https://metadata.google.internal/gallery/a.xyz',
    'https://molecule.local/gallery/a.xyz',
    'https://lupi.live.evil.example/gallery/a.xyz',
    'https://evil.example/lupi.live/gallery/a.xyz',
    'https://storage.googleapis.com/other-bucket/a.xyz',
    'https://storage.googleapis.com/shed-489901-nist-demos.evil/a.xyz',
    'https://lupi.live/private/a.xyz',
    'https://lupi.live/gallery/not-a-molecule?file=a.xyz',
    'https://lupi.live/gallery/not-a-molecule#a.xyz',
    '//lupi.live/gallery/a.xyz',
    '/gallery/../private/a.xyz',
    '/gallery/a.xyz\\evil',
    '/v1/datasets/omol25/not-a-collection/structures/1.xyz',
    '/v1/datasets/omol25/neutral-train/structures/1.xyz?redirect=https://evil.example',
    '/v1/datasets/research/not-in-catalog/files/sample.data',
    '/v1/datasets/research/gst-phase-change-ace-start/files/GST_config.data#other',
  ])('rejects unsafe source %s', (url) => {
    expect(() => assertAllowedRemoteMoleculeUrl(url, 'saved-view', ORIGIN)).toThrow(/remote molecule|supported molecule|not allowed/i);
  });
});
