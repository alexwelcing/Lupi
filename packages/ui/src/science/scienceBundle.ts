/**
 * scienceBundle — the single validated access point for the Z1 golden-panel
 * fixture inside the viewer.
 *
 * The fixture (`z1GoldenPanelFixture.json`) remains the single source of
 * science truth: it is validated fail-closed exactly once at this boundary
 * and handed to the viewer as an immutable bundle. A drifted, mis-
 * regenerated, or corrupted fixture must never become guessed or partial
 * science on screen — every consumer goes through `scienceBundleForPathIndex`
 * and receives `null` instead.
 *
 * The path-index ⇄ gallery-id mapping is derived from the gallery catalog's
 * `sciencePathIndex` field so the two can never drift apart.
 */

import { EXAMPLES } from '../gallery/catalog';
import type { SciencePanelFixture, SciencePathData } from './sciencePanelTypes';
import { validateSciencePanelFixture } from './sciencePanelValidation';
import fixtureJson from './z1GoldenPanelFixture.json';

export interface ScienceViewerBundle {
  fixture: SciencePanelFixture;
  path: SciencePathData;
}

/** Default science route target: the fixture's first golden path. */
export const DEFAULT_Z1_SCIENCE_PATH_INDEX = 16;

/** undefined = not yet validated; null = validated and failed closed. */
let shippedFixtureCache: SciencePanelFixture | null | undefined;

/**
 * Validate the fixture fail-closed. The shipped JSON is validated once and
 * cached; alternate payloads (test seam) are validated on every call and
 * never touch the cache. Returns null — and logs the precise error paths —
 * for any payload that fails validation.
 */
export function validatedScienceFixture(raw: unknown = fixtureJson): SciencePanelFixture | null {
  if (raw === fixtureJson && shippedFixtureCache !== undefined) return shippedFixtureCache;
  const validation = validateSciencePanelFixture(raw);
  if (!validation.ok) {
    console.error('[science-panel] fixture invalid — failing closed:', validation.errors);
    if (raw === fixtureJson) shippedFixtureCache = null;
    return null;
  }
  const fixture = raw as SciencePanelFixture;
  if (raw === fixtureJson) shippedFixtureCache = fixture;
  return fixture;
}

/**
 * Resolve one golden path of the validated fixture. Returns null when the
 * fixture fails validation (fail-closed) or the index is not a golden path.
 */
export function scienceBundleForPathIndex(
  pathIndex: number,
  raw?: unknown,
): ScienceViewerBundle | null {
  const fixture = validatedScienceFixture(raw ?? fixtureJson);
  if (!fixture) return null;
  const path = fixture.paths.find((p) => p.pathIndex === pathIndex);
  return path ? { fixture, path } : null;
}

/** Gallery id whose load attaches the given Z1 golden path's science bundle. */
export function scienceGalleryIdForPathIndex(pathIndex: number): string | null {
  return EXAMPLES.find((e) => e.sciencePathIndex === pathIndex)?.id ?? null;
}

/** Z1 golden path index bound to a gallery id, or null for non-science entries. */
export function sciencePathIndexForGalleryId(id: string): number | null {
  return EXAMPLES.find((e) => e.id === id)?.sciencePathIndex ?? null;
}
