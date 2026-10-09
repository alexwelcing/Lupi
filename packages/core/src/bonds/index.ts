// @atlas/core/bonds — one bond graph for every consumer (strategy §2).
// A pure subpath: the landing chunk never imports it.

export * from './types';
export {
  ACUTE_ANGLE_DEG,
  BOND_TOLERANCE_MAX,
  CLASH_FLOOR_A,
  DEFAULT_BOND_TOLERANCE,
  DONOR_RADII,
  ELEMENT_CLASS,
  HAPTIC_TRIM_RATIO,
  HIGH_SPIN_RADII,
  ION_CONTACT_MARGIN_A,
  ION_COORDINATION_CAPS,
  ION_DONOR_PRECEDENCE_A,
  ION_RADII,
  LONG_EXCESS_A,
  MAX_COORDINATION_A,
  MAX_ION_CONTACT_A,
  METAL_COORDINATION_CAP,
  METAL_HYDRIDE_SLACK_A,
  METAL_METAL_SLACK_A,
  MOLECULAR_RECIPE_MAX_ATOMS,
  NEAR_MISS_WINDOW_A,
  VALENCE_CAPS,
  covalentRadius,
  elementClass,
  metalRadius,
  type ElementClassCode,
} from './classes';
export { clampBondTolerance, perceiveBonds } from './perceive';
export { filterPerceivedBonds } from './filter';
export { selectBondRecipe } from './select';
export { bondMethodParagraph, bondMethodSentence } from './method';
