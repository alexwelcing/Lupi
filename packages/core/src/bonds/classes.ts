import { getElementSpec } from '../elements';

// ─── Thresholds (strategy §2.3) ─────────────────────────────────────

/** Frames above this many atoms keep the distance recipe (same cap as Object Facts). */
export const MOLECULAR_RECIPE_MAX_ATOMS = 2000;
/** Store `bondTolerance` / URL `bt`; clamped to 0..BOND_TOLERANCE_MAX. */
export const DEFAULT_BOND_TOLERANCE = 0.45;
export const BOND_TOLERANCE_MAX = 1.5;
/** Pairs closer than this are never bonded (Open Babel, RDKit and Jmol use the same floor). */
export const CLASH_FLOOR_A = 0.40;
// Lupi choice: harness sensitivity (0.25 / 0.35 / 0.45).
export const ION_CONTACT_MARGIN_A = 0.35;
// Lupi choice: harness sensitivity.
export const METAL_METAL_SLACK_A = 0.25;
// Lupi choice: harness sensitivity. Metal–H cutoff is r_M + r_H + 0.30.
export const METAL_HYDRIDE_SLACK_A = 0.30;
// Lupi choice: harness sensitivity (1.10 / 1.15 / 1.20).
export const HAPTIC_TRIM_RATIO = 1.15;
export const METAL_COORDINATION_CAP = 12;
export const ION_DONOR_PRECEDENCE_A = 0.15;
export const LONG_EXCESS_A = 0.20;
/** Near misses: covalent-class pairs with τ < e ≤ τ + this. */
export const NEAR_MISS_WINDOW_A = 0.20;
/** Bonds closer than this angle at a covalent centre lose the more stretched one. */
export const ACUTE_ANGLE_DEG = 45;
/** cos²(45°) is exactly ½, so the angle test needs no trig. */
export const ACUTE_ANGLE_COS2 = 0.5;

// ─── Element classes (explicit Z sets so they cannot drift) ─────────

export const ELEMENT_CLASS = { hydrogen: 0, covalent: 1, ion: 2, metal: 3, inert: 4 } as const;
export type ElementClassCode = (typeof ELEMENT_CLASS)[keyof typeof ELEMENT_CLASS];

/** s-block ions: ionic contacts only, never covalent sticks. */
export const ION_Z: ReadonlySet<number> = new Set([3, 11, 19, 37, 55, 87, 12, 20, 38, 56, 88]);
/** Never bonded. */
export const INERT_Z: ReadonlySet<number> = new Set([2, 10, 18, 86]);

/** Coordinating metals: Z 21–30, 39–48, 57–80, 89–112. */
export function isCoordinatingMetal(z: number): boolean {
  return (z >= 21 && z <= 30) || (z >= 39 && z <= 48) || (z >= 57 && z <= 80) || (z >= 89 && z <= 112);
}

/** Every Z that is not H, an ion, a coordinating metal or inert is covalent (Be, Al, Ga, In, Tl, Sn, Pb, Bi, Po, Kr, Xe included). */
export function elementClass(z: number): ElementClassCode {
  if (z === 1) return ELEMENT_CLASS.hydrogen;
  if (ION_Z.has(z)) return ELEMENT_CLASS.ion;
  if (INERT_Z.has(z)) return ELEMENT_CLASS.inert;
  if (isCoordinatingMetal(z)) return ELEMENT_CLASS.metal;
  return ELEMENT_CLASS.covalent;
}

// ─── Radii ──────────────────────────────────────────────────────────

/** Single-bond covalent radius: the viewer's table (Cordero 2008, Pyykkö fallback; 1.40 Å for unknown types). */
export function covalentRadius(z: number): number {
  return getElementSpec(z).radius;
}

/** Cordero 2008 high-spin radii, so high-spin complexes are not missed. */
export const HIGH_SPIN_RADII: Readonly<Record<number, number>> = { 25: 1.61, 26: 1.52, 27: 1.50 };

/** A coordinating metal's radius in every metal rule: high-spin for Mn, Fe and Co, covalent otherwise. */
export function metalRadius(z: number): number {
  return HIGH_SPIN_RADII[z] ?? covalentRadius(z);
}

/** Cation radii: Shannon 1976 effective ionic radii, CN6. */
export const ION_RADII: Readonly<Record<number, number>> = {
  3: 0.76, // Li⁺
  11: 1.02, // Na⁺
  19: 1.38, // K⁺
  37: 1.52, // Rb⁺
  55: 1.67, // Cs⁺
  87: 1.80, // Fr⁺
  12: 0.72, // Mg²⁺
  20: 1.00, // Ca²⁺
  38: 1.18, // Sr²⁺
  56: 1.35, // Ba²⁺
  88: 1.48, // Ra²⁺
};

/**
 * Donor contact radii — Lupi's choice of published anion radii. Only these
 * donors make ionic contacts with an s-block ion.
 */
export const DONOR_RADII: Readonly<Record<number, number>> = {
  8: 1.40, // O²⁻, Shannon 1976 CN6
  9: 1.33, // F⁻, Shannon 1976 CN6
  17: 1.81, // Cl⁻, Shannon 1976 CN6
  35: 1.96, // Br⁻, Shannon 1976 CN6
  53: 2.20, // I⁻, Shannon 1976 CN6
  16: 1.84, // S²⁻, Shannon 1976 CN6
  7: 1.46, // N³⁻, Shannon 1976 CN4 (no CN6 value)
  15: 2.12, // P³⁻, Pauling
};

const maxOf = (table: Readonly<Record<number, number>>) => Math.max(...Object.values(table));

/** Longest ionic contact any pair can make: max r_ion + max r_donor + margin (4.35 Å). */
export const MAX_ION_CONTACT_A = maxOf(ION_RADII) + maxOf(DONOR_RADII) + ION_CONTACT_MARGIN_A;

/** Largest metal radius in the element table (Z 21–30, 39–48, 57–80, 89–112). */
export const MAX_METAL_RADIUS_A = (() => {
  let max = 0;
  for (let z = 21; z <= 112; z += 1) if (isCoordinatingMetal(z)) max = Math.max(max, metalRadius(z));
  return max;
})();

/** Upper bound on any coordination cutoff: 2 × max metal radius + τ_max. */
export const MAX_COORDINATION_A = 2 * MAX_METAL_RADIUS_A + BOND_TOLERANCE_MAX;

// ─── Caps ───────────────────────────────────────────────────────────

/** Covalent valence caps. Elements not listed are uncapped. H is 1, or 2 when bridging B–H–B. */
export const VALENCE_CAPS: Readonly<Record<number, number>> = {
  1: 1,
  5: 4, 6: 4, 7: 4, // B, C, N
  8: 3, // Lupi choice: harness sensitivity (O cap 2 / 3).
  9: 1,
  4: 4, // Be
  13: 6, 31: 6, 49: 6, 81: 6, // Al, Ga, In, Tl
  14: 6, 32: 6, 50: 6, 82: 6, // Si, Ge, Sn, Pb
  15: 6, 33: 6, 51: 6, 83: 6, // P, As, Sb, Bi
  16: 6, 34: 6, 52: 6, 84: 6, // S, Se, Te, Po
  17: 7, 35: 7, 53: 7, // Cl, Br, I (allows ClO₄⁻, IF₇, BrF₅)
  54: 8, // Xe
  36: 2, // Kr
};

/**
 * Partner restrictions on top of the cap: at most `limit` covalent partners
 * outside `allowed`. Halogens keep one ordinary partner; Xe and Kr bond only
 * to O/F and F.
 */
export const PARTNER_RULES: Readonly<Record<number, { allowed: ReadonlySet<number>; limit: number }>> = (() => {
  const oxygenOrFluorine = new Set([8, 9]);
  return {
    17: { allowed: oxygenOrFluorine, limit: 1 },
    35: { allowed: oxygenOrFluorine, limit: 1 },
    53: { allowed: oxygenOrFluorine, limit: 1 },
    54: { allowed: oxygenOrFluorine, limit: 0 },
    36: { allowed: new Set([9]), limit: 0 },
  };
})();

// Lupi choice: harness sensitivity (ion caps ±2).
export const ION_COORDINATION_CAPS: Readonly<Record<number, number>> = {
  3: 6, 12: 6, // Li, Mg
  11: 8, 20: 8, // Na, Ca
  19: 10, 38: 10, // K, Sr
  37: 12, 55: 12, 87: 12, 56: 12, 88: 12, // Rb, Cs, Fr, Ba, Ra
};
