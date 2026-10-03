/**
 * card.mts — the share card for a molecule page: 1200×630, the ink drawing of
 * that molecule at the page's opening pose on the sage plate, its name in the
 * house serif, its formula and size, and the link. Written as SVG, rasterised
 * to PNG in Node (node-canvas renders the SVG through librsvg; no browser).
 *
 * Fonts are whatever the build machine's fontconfig resolves for the stacks
 * below (Georgia → Liberation/DejaVu Serif on Linux); the text sits in fixed
 * slots, so a fallback face only changes letterforms, never the layout.
 */
import { INK_PLATE, InkLayout, inkGradientDefs, inkItemsMarkup } from '../../packages/ui/src/moleculePage/ink.ts';
import type { MoleculeRecord } from './catalog.mts';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const LIME = '#d5ef9c';
const INK = '#e7ede9';
const MUTED = '#9fb0a8';
const FAINT = '#6f7f78';
const SERIF = "Georgia, 'Liberation Serif', 'DejaVu Serif', 'Times New Roman', serif";
const SANS = "'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif";
const MONO = "'DejaVu Sans Mono', 'Liberation Mono', Menlo, monospace";

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Greedy word wrap at a character budget. */
function wrapWords(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= maxChars || !line) {
      line = next;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest serif size whose wrap fits the name slot (at most three lines). */
function fitName(name: string): { size: number; lines: string[] } {
  const slot = 470; // px
  for (const size of [80, 68, 58, 50, 44]) {
    const maxChars = Math.floor(slot / (0.5 * size));
    const lines = wrapWords(name, maxChars);
    if (lines.length <= (size >= 68 ? 2 : 3) && lines.every((l) => l.length <= maxChars)) return { size, lines };
  }
  return { size: 40, lines: wrapWords(name, 22).slice(0, 3) };
}

/** A formula as tspans with lowered digits (C8H10N4O2 → C₈H₁₀N₄O₂). */
export function formulaTspans(formula: string, size: number): string {
  const drop = Math.round(size * 0.28);
  let out = '';
  let lowered = false;
  for (const [, letters, digits] of formula.matchAll(/([A-Za-z()]+)(\d*)/g)) {
    out += `<tspan${lowered ? ` dy="${-drop}"` : ''}>${escapeXml(letters)}</tspan>`;
    lowered = false;
    if (digits) {
      out += `<tspan dy="${drop}" font-size="${Math.round(size * 0.68)}">${digits}</tspan>`;
      lowered = true;
    }
  }
  if (lowered) out += `<tspan dy="${-drop}"></tspan>`;
  return out;
}

export function cardAlt(record: MoleculeRecord): string {
  const formula = record.formula ?? record.modelFormula;
  return `Ink illustration of ${record.name} (${formula}), ${record.atoms} atoms, drawn from its coordinates on Lupi's sage plate.`;
}

export function cardSvg(record: MoleculeRecord, origin: string): string {
  const layout = new InkLayout(record.model, { fill: 0.9 });
  layout.update(record.model.opening);
  const formula = record.formula ?? record.modelFormula;
  const { size: nameSize, lines } = fitName(record.name);
  const nameLead = Math.round(nameSize * 1.06);
  const nameTop = 200;
  const nameText = lines
    .map((line, i) => `<tspan x="72" y="${nameTop + i * nameLead}">${escapeXml(line)}</tspan>`)
    .join('');
  const afterName = nameTop + (lines.length - 1) * nameLead;
  const formulaSize = formula.length > 14 ? 28 : 34;
  const formulaY = afterName + 66;
  const stats = [`${record.atoms.toLocaleString('en-US')} atoms`, record.molarMass ? `${record.molarMass.toFixed(2)} g/mol` : null]
    .filter(Boolean)
    .join('  ·  ');
  const link = `${origin.replace(/^https?:\/\//, '')}/m/${record.id}`;
  const drawing = 560;
  const dx = CARD_WIDTH - drawing - 40;
  const dy = (CARD_HEIGHT - drawing) / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<defs>
<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${LIME}" stop-opacity="0.09"/><stop offset="0.7" stop-color="${LIME}" stop-opacity="0.03"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${INK_PLATE}"/>
<circle cx="${dx + drawing / 2}" cy="${dy + drawing / 2}" r="${drawing / 2 + 20}" fill="url(#pool)"/>
<svg x="${dx}" y="${dy}" width="${drawing}" height="${drawing}" viewBox="0 0 200 200" overflow="visible"><defs>${inkGradientDefs(record.model, 'c', layout)}</defs>${inkItemsMarkup(layout, 'c')}</svg>
<circle cx="80" cy="96" r="7" fill="none" stroke="${LIME}" stroke-width="2"/>
<text x="100" y="103" font-family="${SANS}" font-size="20" font-weight="700" letter-spacing="3" fill="${LIME}">LUPI · MOLECULE</text>
<text font-family="${SERIF}" font-size="${nameSize}" fill="${INK}">${nameText}</text>
<text x="72" y="${formulaY}" font-family="${MONO}" font-size="${formulaSize}" fill="${INK}">${formulaTspans(formula, formulaSize)}</text>
<text x="72" y="${formulaY + 48}" font-family="${SANS}" font-size="24" fill="${MUTED}">${escapeXml(stats)}</text>
<rect x="72" y="${CARD_HEIGHT - 112}" width="56" height="2" fill="${LIME}"/>
<text x="72" y="${CARD_HEIGHT - 72}" font-family="${SANS}" font-size="24" font-weight="600" fill="${INK}">${escapeXml(link)}</text>
<text x="72" y="${CARD_HEIGHT - 42}" font-family="${SANS}" font-size="18" fill="${FAINT}">Illustration from coordinates · spin it, then open it in 3D</text>
</svg>
`;
}

type CanvasModule = typeof import('canvas');
let canvasModule: CanvasModule | null | undefined;

async function loadCanvas(): Promise<CanvasModule | null> {
  if (canvasModule !== undefined) return canvasModule;
  try {
    canvasModule = await import('canvas');
  } catch (error) {
    console.warn(`[molecule-pages] node-canvas unavailable, cards fall back to the site card: ${(error as Error).message}`);
    canvasModule = null;
  }
  return canvasModule;
}

/** PNG bytes of a card SVG, or null when no rasteriser is available. */
export async function rasterizeCard(svg: string): Promise<Buffer | null> {
  const canvas = await loadCanvas();
  if (!canvas) return null;
  try {
    const image = await canvas.loadImage(Buffer.from(svg));
    const surface = canvas.createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = surface.getContext('2d');
    context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    return surface.toBuffer('image/png', { compressionLevel: 9 });
  } catch (error) {
    console.warn(`[molecule-pages] card rasterisation failed: ${(error as Error).message}`);
    return null;
  }
}
