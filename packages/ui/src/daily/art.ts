/**
 * art.ts — the Daily's ink looks, from one InkLayout.
 *
 * The clue ladder is a ladder of drawings of the same projected molecule:
 *
 *   silhouette  every atom and bond one flat ink, on paper (clues 1–2)
 *   outline     paper atoms ringed in ink, painted back to front, so rings
 *               and bonds read (clue 3)
 *   colour      the same, each atom filled with its CPK colour (clues 4–6)
 *   lit         the house ink drawing on the sage plate (ink.ts): the bloom
 *               when the molecule is named
 *
 * Strings here (share cards, the yesterday tile); painter.ts draws the same
 * looks as live nodes for the spinning stage. Pure: no DOM.
 */
import { INK_VIEW, InkLayout, type InkModel, type InkPose } from '../moleculePage/ink';

/** Paper behind the clues, a pale sage-grey that sits with the plate. */
export const DAILY_PAPER = '#e7ebe3';
/** The silhouette and outline ink. */
export const DAILY_INK = '#0c1211';
/** Atom ring width in the outline and colour looks (viewBox units). */
export const OUTLINE_WIDTH = 1.15;
export const COLOUR_RING_WIDTH = 0.9;

/** Bonds in the silhouette are drawn a little heavier, so the shape reads as one. */
export function silhouetteBondWidth(layout: InkLayout): number {
  return Math.max(1.2, layout.bondWidth * 1.8);
}

export function outlineBondWidth(layout: InkLayout): number {
  return Math.max(0.9, layout.bondWidth * 1.15);
}

/** Depth cue for the outline looks: back atoms lighter, never invisible. */
export function outlineOpacity(layout: InkLayout, atom: number): number {
  return 0.35 + 0.65 * Math.min(1, Math.max(0, (layout.opacity[atom] - 0.42) / 0.58));
}

export function outlineBondOpacity(layout: InkLayout, bond: number): number {
  return 0.3 + 0.7 * Math.min(1, Math.max(0, (layout.bondOpacity[bond] - 0.2) / 0.68));
}

const fmt = (value: number) => {
  const rounded = Number(value.toFixed(2));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

/** The silhouette: one ink for everything (order does not matter). */
export function silhouetteMarkup(layout: InkLayout, color = DAILY_INK): string {
  let out = `<g fill="${color}" stroke="${color}" stroke-linecap="round" stroke-width="${fmt(silhouetteBondWidth(layout))}">`;
  for (let b = 0; b < layout.bondCount; b += 1) {
    out += `<line x1="${fmt(layout.x1[b])}" y1="${fmt(layout.y1[b])}" x2="${fmt(layout.x2[b])}" y2="${fmt(layout.y2[b])}"/>`;
  }
  for (let i = 0; i < layout.atomCount; i += 1) {
    out += `<circle cx="${fmt(layout.cx[i])}" cy="${fmt(layout.cy[i])}" r="${fmt(layout.r[i])}" stroke="none"/>`;
  }
  return `${out}</g>`;
}

/** Outline (colour = false) or colour (true): ringed atoms and ink bonds, back to front. */
export function outlineMarkup(layout: InkLayout, colour: boolean): string {
  const { model } = layout;
  let out = `<g stroke="${DAILY_INK}" stroke-linecap="round">`;
  for (const item of layout.order) {
    if (item < layout.atomCount) {
      const fill = colour ? model.kinds[model.k[item]].c : DAILY_PAPER;
      out += `<circle cx="${fmt(layout.cx[item])}" cy="${fmt(layout.cy[item])}" r="${fmt(layout.r[item])}" fill="${fill}" stroke-width="${colour ? COLOUR_RING_WIDTH : OUTLINE_WIDTH}" stroke-opacity="${fmt(outlineOpacity(layout, item))}"/>`;
    } else {
      const b = item - layout.atomCount;
      out += `<line x1="${fmt(layout.x1[b])}" y1="${fmt(layout.y1[b])}" x2="${fmt(layout.x2[b])}" y2="${fmt(layout.y2[b])}" stroke-width="${fmt(outlineBondWidth(layout))}" stroke-opacity="${fmt(outlineBondOpacity(layout, b))}"/>`;
    }
  }
  return `${out}</g>`;
}

/** A standalone silhouette SVG (the yesterday tile, before it is tapped). */
export function silhouetteSvg(model: InkModel, pose: InkPose, attrs: Record<string, string> = {}): string {
  const layout = new InkLayout(model);
  layout.update(pose);
  const extra = Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${value.replace(/"/g, '&quot;')}"`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${INK_VIEW} ${INK_VIEW}"${extra}>${silhouetteMarkup(layout)}</svg>`;
}
