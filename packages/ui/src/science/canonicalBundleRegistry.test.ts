import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BUNDLE_REGISTRY,
  canonicalBundleForManifestSha256,
  createCanonicalBundleResolver,
  type CanonicalBundleRegistryEntry,
} from './canonicalBundleRegistry';
import { CANONICAL_VALUE_SOURCE_ASSETS } from './canonicalValueSourceAssets';

describe('canonical bundle supersession resolver', () => {
  it('materializes canonical manifest bytes with platform-independent LF endings', () => {
    for (const entry of Object.values(CANONICAL_BUNDLE_REGISTRY)) {
      expect(entry.serializedManifest).not.toContain('\r');
    }
  });

  it('materializes canonical value-source bytes with platform-independent LF endings', () => {
    for (const source of Object.values(CANONICAL_VALUE_SOURCE_ASSETS)) {
      expect(source).not.toContain('\r');
    }
  });

  it('rejects all stale pre-remediation manifest pins', () => {
    for (const staleDigest of [
      'sha256:f3b25d6073b94430d4f7401987b4984e16de8e3f2bb7c9dc24cb59980697584c',
      'sha256:aba79c0ed7f98a0356a8c1aae31739b5398907805ee8fb2cd86e81f49808b525',
      'sha256:8fa964dffe3742df09f25375c64b145ab34de2dc89888bbe09696d2582bfeaf5',
      'sha256:748143a0099b75d96cd5cc158ab865f00928d14713497f19ea447e6e70a88128',
    ]) {
      expect(canonicalBundleForManifestSha256(staleDigest)).toBeNull();
    }
  });

  it('rejects an old manifest digest after a newer bundle supersedes it', () => {
    const old = CANONICAL_BUNDLE_REGISTRY[16];
    const oldManifest = old.manifest as { bundle_id: string };
    const current: CanonicalBundleRegistryEntry = {
      ...old,
      manifestSha256: `sha256:${'1'.repeat(64)}`,
      manifest: {
        ...(old.manifest as Record<string, unknown>),
        bundle_id: `sha256:${'2'.repeat(64)}`,
        supersedes: oldManifest.bundle_id,
      },
    };
    const resolve = createCanonicalBundleResolver([old, current]);

    expect(resolve(old.manifestSha256)).toBeNull();
    expect(resolve(current.manifestSha256)).toBe(current);
  });
});
