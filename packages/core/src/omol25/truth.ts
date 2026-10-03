/**
 * The words every OMol25 surface uses for what the dataset supplies and what
 * Lupi infers. Surfaces import these instead of writing their own, so the
 * claims stay identical across the home shelf, Library, viewer and agents.
 */

export const OMOL25_CITATION = 'Levine et al. 2025, The Open Molecules 2025 (OMol25) Dataset, arXiv:2505.08762';
export const OMOL25_PAPER_URL = 'https://arxiv.org/abs/2505.08762';
export const OMOL25_LICENSE_URL = 'https://creativecommons.org/licenses/by/4.0/';
/** ColabFit's collection of the public conversions Lupi reads. */
export const OMOL25_ATTRIBUTION_URL = 'https://huggingface.co/collections/colabfit/omol25-open-molecules-2025-colabfit';
export const OMOL25_METHOD = 'ωB97M-V/def2-TZVPD';
/** The bond recipe the viewer applies to OMol25 records (OMol25 itself supplies none). */
export const OMOL25_VIEWER_BOND_RECIPE = 'lupi-bonds.molecular.v1' as const;

export const OMOL25_COORDINATE_TRUTH = 'Source DFT coordinates (ωB97M-V/def2-TZVPD, OMol25).';
export const OMOL25_MASTHEAD_BOND_SENTENCE = 'OMol25 supplies no bond topology; Lupi infers bonds with a published rule and labels them.';

const BOND_TRUTH = 'OMol25 supplies no bonds. Lines are Lupi\'s inference (lupi-bonds.molecular.v1): dotted lines are ionic contacts, dashed lines metal coordination.';
const CARD_TRUTH = 'Source DFT coordinates, charge and spin. OMol25 supplies no bonds; Lupi infers them and labels them.';
const REACTION_PATH_CAVEAT = 'Reaction-path snapshot: stretched bonds may be absent.';
const REACTION_PATH_DOMAINS = new Set(['reactivity', 'trans1x', 'rgd']);
/** At or above this largest-atom force (eV/Å) a geometry is called a snapshot rather than near a minimum. */
export const OMOL25_NEAR_MINIMUM_FORCE = 0.5;

export function omolBondTruth(): string {
  return BOND_TRUTH;
}

export function omolCardTruth(): string {
  return CARD_TRUTH;
}

export function omolAttribution(): string {
  return 'OMol25 (Levine et al., arXiv:2505.08762, CC BY 4.0)';
}

export function omolGeometryState(maxForceEvPerA: number | null): string | null {
  if (maxForceEvPerA === null || !Number.isFinite(maxForceEvPerA) || maxForceEvPerA < 0) return null;
  return maxForceEvPerA >= OMOL25_NEAR_MINIMUM_FORCE
    ? `Snapshot away from a minimum: largest force ${maxForceEvPerA.toFixed(1)} eV/Å`
    : `Near a minimum: largest force ${maxForceEvPerA.toFixed(2)} eV/Å`;
}

const SPIN_WORDS = ['singlet', 'doublet', 'triplet', 'quartet', 'quintet', 'sextet', 'septet', 'octet', 'nonet'];

/** 2S+1 as a word ("doublet"); numeric past nonet. */
export function omolSpinWord(m: number): string {
  return Number.isInteger(m) && m >= 1 && m <= SPIN_WORDS.length ? SPIN_WORDS[m - 1] : `spin multiplicity ${m}`;
}

/** "+1", "−2", "0" with a typographic minus. */
export function omolSignedCharge(q: number): string {
  return q > 0 ? `+${q}` : q < 0 ? `−${Math.abs(q)}` : '0';
}

/**
 * Compact charge and spin: "neutral singlet", "charge +1 · doublet",
 * "charge and spin not recorded".
 */
export function omolChargeSpin(c: { totalCharge: number | null; spinMultiplicity: number | null; source: string }): string {
  const q = c.source === 'unavailable' ? null : c.totalCharge;
  const m = c.source === 'unavailable' ? null : c.spinMultiplicity;
  if (q === null && m === null) return 'charge and spin not recorded';
  if (q === null) return omolSpinWord(m!);
  if (m === null) return q === 0 ? 'neutral' : `charge ${omolSignedCharge(q)}`;
  return q === 0 ? `neutral ${omolSpinWord(m)}` : `charge ${omolSignedCharge(q)} · ${omolSpinWord(m)}`;
}

/** Where charge and spin came from, as a phrase ("from the record"). */
export function omolChargeSourcePhrase(source: string): string {
  switch (source) {
    case 'record': return 'from the record';
    case 'split-definition': return 'by split definition';
    case 'file-declared': return 'declared by the file';
    default: return 'not recorded';
  }
}

export function omolDomainCaveat(domain: string | null): string | null {
  return domain !== null && REACTION_PATH_DOMAINS.has(domain) ? REACTION_PATH_CAVEAT : null;
}

const DOMAIN_LABELS: Record<string, string> = {
  ani2x: 'ANI-2x',
  biomolecules: 'Biomolecules',
  elytes: 'Electrolytes',
  geom_orca6: 'GEOM',
  metal_complexes: 'Metal complexes',
  orbnet_denali: 'OrbNet Denali',
  reactivity: 'Reactivity',
  rgd: 'RGD1',
  spice: 'SPICE',
  trans1x: 'Transition-1x',
};

/** Human label for an OMol25 `data_id` subset. */
export function omolDomainLabel(domain: string | null): string {
  if (domain === null || domain.length === 0) return 'OMol25';
  return DOMAIN_LABELS[domain] ?? domain.replace(/_/g, ' ');
}
