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
  0: entry(0, path0Raw, 'sha256:42c856fe737059ff389443ac6bda5b3604cc735196aaba4b16d45a9a9fa32bc3'),
  14: entry(14, path14Raw, 'sha256:016d2f55b134ef7b94640a56a5bd9146202f3e0289203e321cc314d86ba067db'),
  16: entry(16, path16Raw, 'sha256:22766c56417b9002e03668c65c53bdda5cb3b725946aef5af66105773708b8cf'),
  27: entry(27, path27Raw, 'sha256:21c1e96c92588a592c52d7be0f42af377279b15c6a5bf350481d4e5f5ea0418a'),
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
