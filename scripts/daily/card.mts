/**
 * card.mts — Lupi Daily's share cards, 1200×630, rasterised at build time
 * by node-canvas (librsvg; no browser) as JPEG: a card is soft gradients and
 * one silhouette, and a JPEG is a third the size of the PNG, which matters
 * at ~75 cards per deploy.
 *
 *   /og/daily/<date>.jpg   that day's silhouette, ink on a paper disc, with
 *                          the number, the date and the link. Never the name.
 *   /og/daily.jpg          the same frame with a question mark: /daily/ and
 *                          the text version.
 */
import { InkLayout, type InkModel, type InkPose } from '../../packages/ui/src/moleculePage/ink.ts';
import { DAILY_INK, DAILY_PAPER, silhouetteMarkup } from '../../packages/ui/src/daily/art.ts';
import { formatLongDate, puzzleNumber, type DateKey } from '../../packages/ui/src/daily/schedule.ts';
import { CARD_HEIGHT, CARD_WIDTH } from '../molecule-pages/card.mts';

const PLATE = '#101817';
const LIME = '#d5ef9c';
const INK = '#e7ede9';
const MUTED = '#9fb0a8';
const FAINT = '#6f7f78';
const SERIF = "Georgia, 'Liberation Serif', 'DejaVu Serif', 'Times New Roman', serif";
const SANS = "'Liberation Sans', 'DejaVu Sans', Arial, Helvetica, sans-serif";

const DISC_X = 900;
const DISC_Y = CARD_HEIGHT / 2;
const DISC_R = 252;

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function dailyCardAlt(key: DateKey | null): string {
  return key
    ? `Lupi Daily No. ${puzzleNumber(key)}: the day's mystery molecule as an ink silhouette on a paper disc.`
    : 'Lupi Daily: a mystery molecule every day, drawn as an ink silhouette.';
}

function frame(opts: { kicker: string; dateLine: string; link: string; disc: string }): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
<defs>
<radialGradient id="paper" cx="0.42" cy="0.36" r="0.62"><stop offset="0" stop-color="#f4f7f0"/><stop offset="0.56" stop-color="${DAILY_PAPER}"/><stop offset="1" stop-color="#d3dad0"/></radialGradient>
<radialGradient id="pool" cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stop-color="${LIME}" stop-opacity="0.08"/><stop offset="1" stop-color="${LIME}" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${PLATE}"/>
<circle cx="${DISC_X}" cy="${DISC_Y}" r="${DISC_R + 46}" fill="url(#pool)"/>
<circle cx="${DISC_X}" cy="${DISC_Y}" r="${DISC_R}" fill="url(#paper)"/>
${opts.disc}
<circle cx="80" cy="96" r="7" fill="none" stroke="${LIME}" stroke-width="2"/>
<text x="100" y="103" font-family="${SANS}" font-size="20" font-weight="700" letter-spacing="3" fill="${LIME}">${escapeXml(opts.kicker)}</text>
<text font-family="${SERIF}" font-size="80" fill="${INK}"><tspan x="72" y="214">Who’s that</tspan><tspan x="72" y="298">molecule?</tspan></text>
<text x="72" y="366" font-family="${SANS}" font-size="30" fill="${INK}">${escapeXml(opts.dateLine)}</text>
<text x="72" y="410" font-family="${SANS}" font-size="24" fill="${MUTED}">Six clues. One molecule. The same for everyone.</text>
<rect x="72" y="${CARD_HEIGHT - 112}" width="56" height="2" fill="${LIME}"/>
<text x="72" y="${CARD_HEIGHT - 72}" font-family="${SANS}" font-size="24" font-weight="600" fill="${INK}">${escapeXml(opts.link)}</text>
<text x="72" y="${CARD_HEIGHT - 42}" font-family="${SANS}" font-size="18" fill="${FAINT}">Name it from its silhouette · results never spoil it</text>
</svg>
`;
}

/** The day's card: its silhouette at the day's pose. */
export function dailyCardSvg(key: DateKey, model: InkModel, pose: InkPose, origin: string): string {
  const layout = new InkLayout(model, { fill: 0.84 });
  layout.update(pose);
  const size = DISC_R * 2;
  const disc = `<svg x="${DISC_X - DISC_R}" y="${DISC_Y - DISC_R}" width="${size}" height="${size}" viewBox="0 0 200 200" overflow="visible">${silhouetteMarkup(layout)}</svg>`;
  return frame({
    kicker: `LUPI DAILY · No. ${puzzleNumber(key)}`,
    dateLine: formatLongDate(key),
    link: `${origin.replace(/^https?:\/\//, '')}/daily/${key}`,
    disc,
  });
}

/** The generic card: a question mark in the disc. */
export function dailyGenericCardSvg(origin: string): string {
  const disc = `<text x="${DISC_X}" y="${DISC_Y + 92}" text-anchor="middle" font-family="${SERIF}" font-size="300" fill="${DAILY_INK}">?</text>`;
  return frame({
    kicker: 'LUPI DAILY',
    dateLine: 'A new mystery molecule every day',
    link: `${origin.replace(/^https?:\/\//, '')}/daily`,
    disc,
  });
}

type CanvasModule = typeof import('canvas');
let canvasModule: CanvasModule | null | undefined;

async function loadCanvas(): Promise<CanvasModule | null> {
  if (canvasModule !== undefined) return canvasModule;
  try {
    canvasModule = await import('canvas');
  } catch (error) {
    console.warn(`[daily] node-canvas unavailable, pages fall back to the site card: ${(error as Error).message}`);
    canvasModule = null;
  }
  return canvasModule;
}

/** JPEG bytes of a card SVG, or null when no rasteriser is available. */
export async function rasterizeDailyCard(svg: string): Promise<Buffer | null> {
  const canvas = await loadCanvas();
  if (!canvas) return null;
  try {
    const image = await canvas.loadImage(Buffer.from(svg));
    const surface = canvas.createCanvas(CARD_WIDTH, CARD_HEIGHT);
    const context = surface.getContext('2d');
    context.drawImage(image, 0, 0, CARD_WIDTH, CARD_HEIGHT);
    return surface.toBuffer('image/jpeg', { quality: 0.9, progressive: true, chromaSubsampling: false });
  } catch (error) {
    console.warn(`[daily] card rasterisation failed: ${(error as Error).message}`);
    return null;
  }
}
