import type { ObjectFactsInput, ObjectFactsOptions, ObjectFactsV1 } from './types';

export type * from './types';

/**
 * Principal axes, rings, symmetry axes and view detents for a static structure.
 * WP0 stub: returns null until the real implementation lands (WP2), so callers
 * keep the isotropic coast and no detents.
 */
export function computeObjectFacts(
  input: ObjectFactsInput,
  options?: ObjectFactsOptions,
): ObjectFactsV1 | null {
  void input;
  void options;
  return null;
}
