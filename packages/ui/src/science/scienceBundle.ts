/** Canonical Z1 visualization-bundle registry and viewer adapter boundary. */
import type { Trajectory } from '@atlas/core/types';
import {
  verifyVisualizationBundle,
  verifyVisualizationManifest,
} from './adaptVisualizationBundle';
import {
  canonicalBundleForManifestSha256,
  canonicalBundleSupersedesChain,
  CANONICAL_BUNDLE_REGISTRY,
} from './canonicalBundleRegistry';
import type { SciencePanelFixture, SciencePathData } from './sciencePanelTypes';

export interface ScienceViewerBundle {
  fixture: SciencePanelFixture;
  path: SciencePathData;
}

export const DEFAULT_Z1_SCIENCE_PATH_INDEX = 16;

type CampaignManifestFields = {
  campaign_id: string;
  created_at: string;
  producer: { tool: string; normalized_parameters: Record<string, unknown> };
  provenance: {
    preregistration: string;
    amendments: string[];
    citation: { dataset: string; doi: string; theory: string };
  };
  quality_gates: { thresholds_mev: { strong_win: number; win: number; t1_gate: number } };
};

async function verifiedCanonicalPaths(): Promise<SciencePathData[]> {
  const paths = await Promise.all(Object.values(CANONICAL_BUNDLE_REGISTRY).map(async (entry) => {
    const path = await verifyVisualizationManifest({
      serializedManifest: entry.serializedManifest,
      expectedManifestSha256: entry.manifestSha256,
      supersedesChain: canonicalBundleSupersedesChain(entry),
    });
    if (path.pathIndex !== entry.pathIndex) {
      throw new Error(
        `Canonical registry path mismatch: digest ${entry.manifestSha256} is registered for ` +
        `${entry.pathIndex} but manifest declares ${path.pathIndex}`,
      );
    }
    return path;
  }));
  return paths.sort((a, b) => a.pathIndex - b.pathIndex);
}

function fixtureFromPaths(paths: SciencePathData[]): SciencePanelFixture {
  const entry = CANONICAL_BUNDLE_REGISTRY[DEFAULT_Z1_SCIENCE_PATH_INDEX];
  const manifest = entry.manifest as CampaignManifestFields;
  const contaminated = paths.filter((path) => path.t1.verdict === 'contaminated').length;
  const wander = paths.map((path) => path.t1.wanderMev);
  const citation = manifest.provenance.citation;
  return {
    schema: 'lupine.visualization-bundle.v1',
    generatedBy: manifest.producer.tool,
    provenance: {
      campaignFile: paths[0].revision.sources.campaign,
      barrierLockFile: paths[0].revision.sources.barrierLock,
      anchorReceiptDir: 'content-addressed digests on each bundle revision',
      modelInputDir: 'content-addressed digests on each bundle revision',
    },
    campaign: {
      id: manifest.campaign_id,
      sha256: paths[0].revision.campaignSha256,
      recordedAt: manifest.created_at,
      preregistration: manifest.provenance.preregistration,
      amendment: manifest.provenance.amendments.join('; '),
      thresholds: {
        strongWinMev: manifest.quality_gates.thresholds_mev.strong_win,
        winMev: manifest.quality_gates.thresholds_mev.win,
        t1GateMev: manifest.quality_gates.thresholds_mev.t1_gate,
        basis: 'same-engine (sparse GPAW vs dense same-engine GPAW profile)',
      },
      gpawParams: manifest.producer.normalized_parameters,
      t1Summary: {
        pathsWithOffsets: paths.length,
        pathsContaminated: contaminated,
        maxOffsetWanderMev: Math.max(...wander),
        meanOffsetWanderMev: wander.reduce((sum, value) => sum + value, 0) / wander.length,
      },
      citation: `${citation.dataset}; DOI ${citation.doi}; ${citation.theory}`,
    },
    paths,
  };
}

/** Verify every canonical bundle and return the requested standalone science panel. */
export async function verifiedSciencePanelBundleForPathIndex(
  pathIndex: number,
): Promise<ScienceViewerBundle | null> {
  if (!CANONICAL_BUNDLE_REGISTRY[pathIndex]) return null;
  try {
    const fixture = fixtureFromPaths(await verifiedCanonicalPaths());
    const path = fixture.paths.find((candidate) => candidate.pathIndex === pathIndex);
    return path ? { fixture, path } : null;
  } catch (error) {
    console.error('[science-panel] canonical bundle invalid — failing closed:', error);
    return null;
  }
}

/** Compatibility resolver; production gallery loading resolves the digest directly. */
export async function verifiedScienceBundleForPathIndex(
  pathIndex: number,
  trajectory: Trajectory,
): Promise<ScienceViewerBundle | null> {
  const entry = CANONICAL_BUNDLE_REGISTRY[pathIndex];
  if (!entry) return null;
  return verifiedScienceBundleForManifestSha256(entry.manifestSha256, trajectory, pathIndex);
}

/** Resolve and verify an exact serialized-manifest content digest as one load gate. */
export async function verifiedScienceBundleForManifestSha256(
  manifestSha256: string,
  trajectory: Trajectory,
  expectedPathIndex?: number,
): Promise<ScienceViewerBundle | null> {
  const entry = canonicalBundleForManifestSha256(manifestSha256);
  if (!entry || (expectedPathIndex != null && entry.pathIndex !== expectedPathIndex)) return null;
  try {
    const verifiedPath = await verifyVisualizationBundle({
      serializedManifest: entry.serializedManifest,
      expectedManifestSha256: manifestSha256,
      trajectory,
      supersedesChain: canonicalBundleSupersedesChain(entry),
    });
    if (verifiedPath.pathIndex !== entry.pathIndex) {
      throw new Error(
        `Canonical registry path mismatch: digest ${manifestSha256} is registered for ` +
        `${entry.pathIndex} but manifest declares ${verifiedPath.pathIndex}`,
      );
    }
    const paths = (await verifiedCanonicalPaths()).map((path) => (
      path.pathIndex === entry.pathIndex ? verifiedPath : path
    ));
    const fixture = fixtureFromPaths(paths);
    return { fixture, path: verifiedPath };
  } catch (error) {
    console.error('[science-panel] canonical bundle verification failed — failing closed:', error);
    return null;
  }
}
