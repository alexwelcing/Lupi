import { describe, expect, it } from 'vitest';
import {
  CANONICAL_BUNDLE_REGISTRY,
  createCanonicalBundleResolver,
  type CanonicalBundleRegistryEntry,
} from './canonicalBundleRegistry';

describe('canonical bundle supersession resolver', () => {
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