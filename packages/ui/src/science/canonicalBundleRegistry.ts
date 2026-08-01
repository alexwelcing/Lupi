import path0Raw from './canonical-bundles/path-0.visualization-bundle.json?raw';
import path14Raw from './canonical-bundles/path-14.visualization-bundle.json?raw';
import path16Raw from './canonical-bundles/path-16.visualization-bundle.json?raw';
import path27Raw from './canonical-bundles/path-27.visualization-bundle.json?raw';

export interface CanonicalBundleRegistryEntry {
  pathIndex: number;
  manifest: unknown;
  serializedManifest: string;
  manifestSha256: string;
}

type BundleIdentity = { bundle_id: string; supersedes: string | null };

function entry(pathIndex: number, serializedManifest: string, manifestSha256: string): CanonicalBundleRegistryEntry {
  return { pathIndex, manifest: JSON.parse(serializedManifest) as unknown, serializedManifest, manifestSha256 };
}

/** Exact canonical bytes from lupine-rhizo main and their serialized-manifest digests. */
export const CANONICAL_BUNDLE_REGISTRY: Readonly<Record<number, CanonicalBundleRegistryEntry>> = {
  0: entry(0, path0Raw, 'sha256:f3b25d6073b94430d4f7401987b4984e16de8e3f2bb7c9dc24cb59980697584c'),
  14: entry(14, path14Raw, 'sha256:aba79c0ed7f98a0356a8c1aae31739b5398907805ee8fb2cd86e81f49808b525'),
  16: entry(16, path16Raw, 'sha256:8fa964dffe3742df09f25375c64b145ab34de2dc89888bbe09696d2582bfeaf5'),
  27: entry(27, path27Raw, 'sha256:748143a0099b75d96cd5cc158ab865f00928d14713497f19ea447e6e70a88128'),
};

function identityOf(entry: CanonicalBundleRegistryEntry): BundleIdentity {
  const manifest = entry.manifest as Partial<BundleIdentity>;
  if (typeof manifest.bundle_id !== 'string' || (manifest.supersedes != null && typeof manifest.supersedes !== 'string')) {
    throw new Error(`Canonical registry entry ${entry.manifestSha256} has invalid supersession identity`);
  }
  return { bundle_id: manifest.bundle_id, supersedes: manifest.supersedes ?? null };
}

/** Build a fail-closed digest resolver: any bundle named by a successor is stale. */
export function createCanonicalBundleResolver(entries: readonly CanonicalBundleRegistryEntry[]) {
  const byDigest = new Map(entries.map((bundle) => [bundle.manifestSha256, bundle]));
  const supersededBundleIds = new Set(
    entries.flatMap((bundle) => {
      const supersedes = identityOf(bundle).supersedes;
      return supersedes ? [supersedes] : [];
    }),
  );
  return (manifestSha256: string): CanonicalBundleRegistryEntry | null => {
    const candidate = byDigest.get(manifestSha256);
    if (!candidate || supersededBundleIds.has(identityOf(candidate).bundle_id)) return null;
    return candidate;
  };
}

/** Return immediate-to-oldest bundle IDs, rejecting cycles. */
export function canonicalBundleSupersedesChain(
  bundle: CanonicalBundleRegistryEntry,
  entries: readonly CanonicalBundleRegistryEntry[] = Object.values(CANONICAL_BUNDLE_REGISTRY),
): string[] {
  const byBundleId = new Map(entries.map((candidate) => [identityOf(candidate).bundle_id, candidate]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let predecessor = identityOf(bundle).supersedes;
  while (predecessor) {
    if (seen.has(predecessor)) throw new Error(`Canonical bundle supersession cycle at ${predecessor}`);
    seen.add(predecessor);
    chain.push(predecessor);
    const predecessorEntry = byBundleId.get(predecessor);
    if (!predecessorEntry) break;
    predecessor = identityOf(predecessorEntry).supersedes;
  }
  return chain;
}

const resolveCanonicalBundle = createCanonicalBundleResolver(Object.values(CANONICAL_BUNDLE_REGISTRY));

/** Resolve only exact serialized-manifest identities; aliases and path IDs are not accepted. */
export function canonicalBundleForManifestSha256(manifestSha256: string): CanonicalBundleRegistryEntry | null {
  return resolveCanonicalBundle(manifestSha256);
}
