/**
 * Color schemes — directorial atom-coloring decisions.
 *
 * Same pattern as the postprocess presets: a coherent recipe (atom color
 * mode + palette source) bundled into one editorial choice. The drawer picks
 * one; the granular fields underneath get set by the scheme resolver.
 *
 * Adding a new scheme: append a SchemeId, define the SchemeProfile here,
 * and update `setColorScheme` in the store. Most user complaints about
 * "looks weird" should be fixable by tweaking a scheme's parameters
 * rather than adding a new toggle to the panel.
 */

import type { ColorMode } from '@atlas/core/types';

export type ColorSchemeId = 'element' | 'colorway' | 'property' | 'uniform';

/**
 * The source of per-atom color when atom color mode is 'type'. Determines
 * the palette texture's contents. Bonds inherit by reading the same source.
 *
 *   'colormap'  — sample the active colormap at the type's normalized rank.
 *                 Good when the dataset doesn't carry chemical identity (e.g.
 *                 generic LAMMPS dumps with type=1,2,3 and no element map).
 *   'element'   — use the element's natural color from getElementSpec.
 *                 Cu reads orange, O reads red, Au reads gold.
 */
export type AtomColorSource = 'colormap' | 'element';

export interface SchemeProfile {
  id: ColorSchemeId;
  label: string;
  tagline: string;
  /** Atom color mode the scheme implies. Most schemes use 'type'; only
   *  Property uses 'property'; Uniform uses 'uniform'. */
  atomColorMode: ColorMode;
  /** Where the per-type palette comes from when atomColorMode === 'type'. */
  atomColorSource: AtomColorSource;
}

export const COLOR_SCHEMES: Record<ColorSchemeId, SchemeProfile> = {
  element: {
    id: 'element',
    label: 'Element',
    tagline: 'Natural element colors. Cu warm, Au gold, O red.',
    atomColorMode: 'type',
    atomColorSource: 'element',
  },
  colorway: {
    id: 'colorway',
    label: 'Colorway',
    tagline: 'Spread a colorway across the atoms — one hue per element.',
    atomColorMode: 'type',
    atomColorSource: 'colormap',
  },
  property: {
    id: 'property',
    label: 'Property',
    tagline: 'Map the colorway onto a loaded per-atom scalar.',
    atomColorMode: 'property',
    atomColorSource: 'colormap', // property mode reads from uColormap, not uPalette
  },
  uniform: {
    id: 'uniform',
    label: 'Uniform',
    tagline: 'Single color across all atoms. Lets shape and material speak.',
    atomColorMode: 'uniform',
    atomColorSource: 'colormap', // not used in uniform mode
  },
};

export const SCHEME_ORDER: ColorSchemeId[] = ['element', 'colorway', 'property', 'uniform'];

/**
 * Pick the default scheme for a freshly-loaded file. Property data is often
 * diagnostic, but the viewer's first read should be molecular identity.
 * Users can still switch to Colorway or Property explicitly from Molecule Color.
 *
 *   - Element is the default for all molecular loads.
 *   - Colorway, Property, and Uniform are opt-in looks.
 */
export function pickInitialScheme(_opts: {
  hasProperty: boolean;
  uniqueTypes: number;
}): ColorSchemeId {
  return 'element';
}
