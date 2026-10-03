/**
 * bondStatus.ts — the bond fields agents read from status(), `lupi.status`
 * and `lupi.viewer_state` (strategy §2.12), and the per-pair list behind
 * `lupi.viewer_state { includeBonds: true }`.
 *
 * Molecular and distance frames of at most 2,000 atoms read the shared cache
 * (`getPerceivedBonds`) through the view's own filter, so an agent sees the
 * graph that is drawn, synchronously after a `lupi.set_viewer`. Larger frames
 * report what the bond layer last drew.
 */
import { covalentRadius, filterPerceivedBonds, BOND_KIND_NAMES, DEFAULT_BOND_TOLERANCE, MOLECULAR_RECIPE_ID } from '@atlas/core/bonds';
import type { BondKindName, BondRecipeId, DrawnBonds, PerceivedBonds } from '@atlas/core/bonds';
import { resolveAtomicNumber } from '@atlas/core';
import type { Frame } from '@atlas/core/types';
import { validateSourceBondTopology } from '@atlas/scene';
import type { AppState } from '../store';
import { getPerceivedBonds, resolveFrameRecipe } from '../bonds/perceivedBonds';

export const MAX_LISTED_BONDS = 5000;

export interface McpBondKinds { covalent: number; coordination: number; ionicContact: number }
export interface McpBondEvidence { long: number; removed: number; nearMiss: number; clashes: number }

export interface McpBondStatus {
  /** Covalent plus coordination bonds drawn (ionic contacts are not bonds). */
  bondCount: number;
  /** The rule the current frame gets: 'source', a recipe id, or null when nothing can be drawn. */
  bondRecipe: BondRecipeId | 'source' | null;
  /** The tolerance differs from the default 0.45 Å. */
  bondToleranceAdjusted: boolean;
  /** Drawn bonds by kind (zeros while bonds are hidden). */
  bondKinds: McpBondKinds;
  /** The recipe's evidence for the whole frame; null for source bonds or frames above 2,000 atoms. */
  bondEvidence: McpBondEvidence | null;
  chemistry: { totalCharge: number | null; spinMultiplicity: number | null; source: string; domain: string | null } | null;
}

type BondState = Pick<
  AppState,
  'file' | 'frame' | 'showBonds' | 'bondProfile' | 'bondTolerance' | 'showBondContacts' | 'hiddenAtomTypes' | 'lastBondCount' | 'lastBondDetail'
>;

function currentFrame(state: BondState): Frame | undefined {
  return state.file?.trajectory.frames[state.frame];
}

function frameRecipe(state: BondState, frame: Frame): BondRecipeId | 'source' | null {
  return resolveFrameRecipe(frame, {
    profile: state.bondProfile,
    frameCount: state.file?.trajectory.totalFrames ?? state.file?.trajectory.frames.length ?? 1,
  });
}

/** The cached graph and its drawn view, for inferred recipes up to 2,000 atoms. */
function inferredView(state: BondState, frame: Frame, recipe: BondRecipeId): { perceived: PerceivedBonds; drawn: DrawnBonds } | null {
  const perceived = getPerceivedBonds(frame, { recipe, tolerance: state.bondTolerance });
  if (!perceived) return null;
  const drawn = filterPerceivedBonds(perceived, {
    types: frame.types,
    hiddenTypes: new Set(state.hiddenAtomTypes),
    showContacts: state.showBondContacts,
  });
  return { perceived, drawn };
}

function kindCounts(drawn: Pick<DrawnBonds, 'count' | 'kinds'>): McpBondKinds {
  const kinds = { covalent: 0, coordination: 0, ionicContact: 0 };
  for (let k = 0; k < drawn.count; k += 1) kinds[BOND_KIND_NAMES[drawn.kinds[k]] ?? 'covalent'] += 1;
  return kinds;
}

export function readBondStatus(state: BondState): McpBondStatus {
  const frame = currentFrame(state);
  const chemistry = frame?.chemistry
    ? {
      totalCharge: frame.chemistry.totalCharge,
      spinMultiplicity: frame.chemistry.spinMultiplicity,
      source: frame.chemistry.source,
      domain: frame.chemistry.domain,
    }
    : null;
  const bondToleranceAdjusted = Math.abs(state.bondTolerance - DEFAULT_BOND_TOLERANCE) > 1e-9;
  const recipe = frame ? frameRecipe(state, frame) : null;
  const view = frame && recipe && recipe !== 'source' ? inferredView(state, frame, recipe) : null;
  const bondEvidence = view
    ? {
      long: view.perceived.counts.long,
      removed: view.perceived.counts.removed,
      nearMiss: view.perceived.counts.nearMiss,
      clashes: view.perceived.counts.clashes,
    }
    : null;

  if (!state.showBonds) {
    return {
      bondCount: 0,
      bondRecipe: recipe,
      bondToleranceAdjusted,
      bondKinds: { covalent: 0, coordination: 0, ionicContact: 0 },
      bondEvidence,
      chemistry,
    };
  }
  // The molecular layer draws exactly the filtered cache; read it directly.
  if (view && recipe === MOLECULAR_RECIPE_ID) {
    const bondKinds = kindCounts(view.drawn);
    return {
      bondCount: bondKinds.covalent + bondKinds.coordination,
      bondRecipe: recipe,
      bondToleranceAdjusted,
      bondKinds,
      bondEvidence,
      chemistry,
    };
  }
  const reported = state.lastBondDetail?.kinds;
  return {
    bondCount: state.lastBondCount,
    bondRecipe: recipe,
    bondToleranceAdjusted,
    bondKinds: reported ?? { covalent: state.lastBondCount, coordination: 0, ionicContact: 0 },
    bondEvidence,
    chemistry,
  };
}

/** [i, j, kind, length Å, excess over the covalent-radius sum Å (null when an element is unknown)]. */
export type McpBondTuple = [number, number, BondKindName, number, number | null];

export interface McpBondList {
  bonds: McpBondTuple[];
  bondsTruncated: boolean;
  bondsFilter: { hiddenTypes: number[]; contacts: boolean };
  /** Set when no per-pair list exists for this frame (e.g. above 2,000 atoms). */
  bondsUnavailable?: string;
}

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * The bonds the view draws for the current frame (whether or not bonds are
 * shown) as [i, j, kind, lengthÅ, excessÅ], at most 5,000. Source pairs are
 * listed as covalent with their source-coordinate length.
 */
export function listViewerBonds(state: BondState, limit = MAX_LISTED_BONDS): McpBondList {
  const hiddenTypes = Array.from(state.hiddenAtomTypes).sort((a, b) => a - b);
  const bondsFilter = { hiddenTypes, contacts: state.showBondContacts };
  const frame = currentFrame(state);
  if (!frame) return { bonds: [], bondsTruncated: false, bondsFilter, bondsUnavailable: 'No molecule is loaded.' };
  const recipe = frameRecipe(state, frame);
  if (recipe === null) {
    return { bonds: [], bondsTruncated: false, bondsFilter, bondsUnavailable: 'This frame has no source bonds and does not prove element identity and Ångström distances.' };
  }

  if (recipe === 'source') {
    if (!validateSourceBondTopology(frame).valid) {
      return { bonds: [], bondsTruncated: false, bondsFilter, bondsUnavailable: 'The source bond topology is malformed.' };
    }
    const hidden = new Set(hiddenTypes);
    const radius = new Map<number, number | null>();
    const radiusOf = (type: number) => {
      if (!radius.has(type)) {
        const z = resolveAtomicNumber(frame, type);
        radius.set(type, z === undefined ? null : covalentRadius(z));
      }
      return radius.get(type) ?? null;
    };
    const bonds: McpBondTuple[] = [];
    let truncated = false;
    for (let k = 0; k < frame.bonds.length / 2; k += 1) {
      const i = frame.bonds[2 * k];
      const j = frame.bonds[2 * k + 1];
      if (hidden.has(frame.types[i]) || hidden.has(frame.types[j])) continue;
      if (bonds.length >= limit) {
        truncated = true;
        break;
      }
      const p = frame.positions;
      const d = Math.sqrt((p[3 * j] - p[3 * i]) ** 2 + (p[3 * j + 1] - p[3 * i + 1]) ** 2 + (p[3 * j + 2] - p[3 * i + 2]) ** 2);
      const ri = radiusOf(frame.types[i]);
      const rj = radiusOf(frame.types[j]);
      bonds.push([i, j, 'covalent', round4(d), ri === null || rj === null ? null : round4(d - ri - rj)]);
    }
    return { bonds, bondsTruncated: truncated, bondsFilter };
  }

  const view = inferredView(state, frame, recipe);
  if (!view) {
    return { bonds: [], bondsTruncated: false, bondsFilter, bondsUnavailable: 'Per-pair bonds are listed for frames of at most 2,000 atoms.' };
  }
  const { drawn } = view;
  const count = Math.min(drawn.count, limit);
  const bonds: McpBondTuple[] = [];
  for (let k = 0; k < count; k += 1) {
    bonds.push([
      drawn.pairs[2 * k],
      drawn.pairs[2 * k + 1],
      BOND_KIND_NAMES[drawn.kinds[k]],
      round4(drawn.distances[k]),
      round4(drawn.excess[k]),
    ]);
  }
  return { bonds, bondsTruncated: drawn.count > limit, bondsFilter };
}
