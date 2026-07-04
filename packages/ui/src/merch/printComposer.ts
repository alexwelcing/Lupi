/**
 * printComposer — composes the two finished assets a listing needs:
 *
 *   • print file — the production art Gooten prints. Placement and scale come
 *     from the product's archetype (artDirection.PLACEMENTS): the tee is an
 *     oversized specimen cropped by the print area, the cap a micro-emblem, the
 *     mug an editorial wrap, the poster an opaque gallery print. Garment prints
 *     are transparent (the fabric shows) with only a whisper of type so they
 *     read on any colour; the poster carries the full, restrained title block.
 *   • mockup tile — a flat-lay lookbook image (garments.ts) showing the piece
 *     on a studio ground with the molecule placed exactly as it prints, so the
 *     storefront grid reads as one editioned collection.
 *
 * All the drawing primitives live in canvasKit; this module is composition +
 * per-product art direction only. Browser canvas only.
 */

import type { GootenPrintSpec, MerchProduct, MerchVariant } from './merchCatalog';
import { printSpecFor } from './merchCatalog';
import {
  LUPI_PALETTE,
  assignLook,
  ensureBrandFonts,
  type Look,
  type MoleculeDescriptor,
} from './artDirection';
import { drawGarmentMockup } from './garments';
import {
  type ComposeResult,
  canvasToPngBlob,
  drawAura,
  drawFormula,
  drawHairline,
  drawLabel,
  drawMoleculeScaled,
  drawOrbit,
  drawRegistrationTicks,
  drawVignette,
  fillVertical,
  fitDisplaySize,
  loadImageElement,
  newCanvas,
  trimToContent,
} from './canvasKit';

// Re-exported so existing callers (the MCP bridge) keep working unchanged.
export { loadImageElement, trimToContent };
export type { ComposeResult };

// ─── print-file compositions ────────────────────────────────────────

/** Poster — opaque gallery print. Two looks live at opposite extremes:
 *  'specimen' floats a small molecule in a vast dark field with a full title
 *  block; 'colossal' blows the molecule past the sheet edges — an abstract
 *  crop of bonds — signed only by a whisper line at the foot. */
function paintPoster(ctx: CanvasRenderingContext2D, w: number, h: number, molecule: CanvasImageSource, d: MoleculeDescriptor, look: Look) {
  const m = w * 0.088;
  const p = look.placement;
  fillVertical(ctx, w, h, LUPI_PALETTE.groundTop, LUPI_PALETTE.groundBottom);

  const cx = w * p.anchor[0];
  const cy = h * p.anchor[1];
  const molLong = p.scale * w;
  if (look.name === 'specimen') drawOrbit(ctx, cx, cy, molLong * 0.62, molLong * 0.24, d.accent, 0.15);
  drawAura(ctx, cx, cy, Math.min(molLong * 0.6, w * 0.75), d.accent, look.name === 'colossal' ? 0.7 : 1);
  drawMoleculeScaled(ctx, molecule, cx, cy, molLong, { shadow: w * 0.02 });
  drawVignette(ctx, w, h, w / 2, h * 0.4, look.name === 'colossal' ? 0.62 : 0.55);

  if (look.name === 'colossal') {
    // signature line only — the crop is the art
    const y = h - m * 0.85;
    drawLabel(ctx, d.name, m, y, { font: 'display', size: w * 0.052, weight: 380, tracking: w * 0.004, color: LUPI_PALETTE.bone, align: 'left' });
    drawFormula(ctx, d.formulaParts, w - m, y, { size: w * 0.028, color: LUPI_PALETTE.bone, weight: 500, tracking: w * 0.028 * 0.03, align: 'right' });
    drawLabel(ctx, `LUPI · MOLECULAR EDITIONS · Nº ${d.code}–001`, m, y + w * 0.028, { font: 'mono', size: w * 0.014, weight: 400, tracking: w * 0.014 * 0.3, color: LUPI_PALETTE.boneMuted, align: 'left' });
    return;
  }

  // 'specimen' — restrained title block, lower third
  let y = h * 0.75;
  const nameSize = fitDisplaySize(ctx, d.name, w - m * 2, w * 0.115, 360, w * 0.006);
  drawLabel(ctx, d.name, m, y, { font: 'display', size: nameSize, weight: 360, tracking: w * 0.006, color: LUPI_PALETTE.bone, align: 'left' });
  y += nameSize * 0.34;
  drawHairline(ctx, m, w - m, y, d.accent, Math.max(1.5, w * 0.0016), 0.85);
  y += w * 0.05;
  const dataSize = w * 0.031;
  drawFormula(ctx, d.formulaParts, m, y, { size: dataSize, color: LUPI_PALETTE.bone, weight: 500, tracking: dataSize * 0.02 });
  drawLabel(ctx, `${d.atomCount} ATOMS`, w - m, y, { font: 'mono', size: dataSize * 0.66, weight: 400, tracking: dataSize * 0.16, color: LUPI_PALETTE.boneMuted, align: 'right' });
  if (d.tagline) {
    y += dataSize * 1.7;
    drawLabel(ctx, d.tagline, m, y, { font: 'display', size: w * 0.032, italic: true, weight: 380, tracking: w * 0.0003, color: LUPI_PALETTE.bone, align: 'left' });
  }
  drawLabel(ctx, 'LUPI · MOLECULAR EDITIONS', m, h - m * 0.7, { font: 'mono', size: w * 0.0155, weight: 500, tracking: w * 0.0155 * 0.32, color: LUPI_PALETTE.boneMuted, align: 'left' });
  drawLabel(ctx, `Nº ${d.code}–001`, w - m, h - m * 0.7, { font: 'mono', size: w * 0.0155, weight: 500, tracking: w * 0.0155 * 0.26, color: LUPI_PALETTE.boneMuted, align: 'right' });
  drawRegistrationTicks(ctx, w, h, m * 0.55, d.accent, 0.5);
}

/** Mug — white ceramic, charcoal ink. 'wrap' is the editorial name/molecule
 *  spread; 'mark' is a single tiny specimen dead-centre with its formula —
 *  nothing else on the cup. */
function paintMug(ctx: CanvasRenderingContext2D, w: number, h: number, molecule: CanvasImageSource, d: MoleculeDescriptor, look: Look, safeMargin: number) {
  const p = look.placement;
  if (look.name === 'mark') {
    const cx = w * p.anchor[0];
    const cy = h * p.anchor[1];
    const molLong = p.scale * w;
    drawAura(ctx, cx, cy, molLong * 0.7, d.accent, 0.35);
    drawMoleculeScaled(ctx, molecule, cx, cy, molLong);
    const dataSize = h * 0.052;
    drawFormula(ctx, d.formulaParts, cx, cy + molLong * 0.62 + dataSize, { size: dataSize, color: LUPI_PALETTE.ink, weight: 500, tracking: dataSize * 0.04, align: 'center' });
    return;
  }

  const pad = w * safeMargin;
  const vPad = h * (safeMargin + 0.05);
  const dividerX = w * 0.5;

  // specimen on the right with a soft accent halo (prints as a light tint)
  const cx = w * p.anchor[0];
  const cy = h * p.anchor[1];
  const molLong = p.scale * w;
  drawAura(ctx, cx, cy, molLong * 0.5, d.accent, 0.5);
  drawMoleculeScaled(ctx, molecule, cx, cy, molLong);

  // divider hairline between the specimen and the lockup
  ctx.save();
  ctx.strokeStyle = d.accent;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = Math.max(1.5, w * 0.0012);
  ctx.beginPath();
  ctx.moveTo(dividerX, vPad); ctx.lineTo(dividerX, h - vPad);
  ctx.stroke();
  ctx.restore();

  // tucked lockup on the left, right-aligned to the divider
  const rightEdge = dividerX - w * 0.04;
  const leftEdge = pad;
  const maxW = rightEdge - leftEdge;
  let y = h * 0.42;
  const nameSize = fitDisplaySize(ctx, d.name, maxW, h * 0.26, 380, w * 0.0025);
  drawLabel(ctx, d.name, rightEdge, y, { font: 'display', size: nameSize, weight: 380, tracking: w * 0.0025, color: LUPI_PALETTE.ink, align: 'right' });
  y += nameSize * 0.32;
  drawHairline(ctx, leftEdge + maxW * 0.35, rightEdge, y, d.accent, Math.max(1.5, w * 0.0014), 0.8);
  y += h * 0.085;
  const dataSize = h * 0.058;
  drawFormula(ctx, d.formulaParts, rightEdge, y, { size: dataSize, color: LUPI_PALETTE.ink, weight: 500, tracking: dataSize * 0.02, align: 'right' });
  y += dataSize * 1.15;
  drawLabel(ctx, 'LUPI · MOLECULAR EDITIONS', rightEdge, y, { font: 'mono', size: h * 0.026, weight: 500, tracking: h * 0.026 * 0.3, color: LUPI_PALETTE.inkMuted, align: 'right' });
}

/** Tee — transparent chest print. 'grand' crops an oversized specimen with a
 *  whisper hem tab; 'pocket' sets a jewel-small mark where a pocket would sit,
 *  captioned by a tiny formula. */
function paintTee(ctx: CanvasRenderingContext2D, w: number, h: number, molecule: CanvasImageSource, d: MoleculeDescriptor, look: Look) {
  const p = look.placement;
  const cx = w * p.anchor[0];
  const cy = h * p.anchor[1];
  const molLong = p.scale * w;
  drawMoleculeScaled(ctx, molecule, cx, cy, molLong);
  if (look.name === 'pocket') {
    const dataSize = molLong * 0.13;
    drawFormula(ctx, d.formulaParts, cx, cy + molLong * 0.62 + dataSize, { size: dataSize, color: LUPI_PALETTE.bone, weight: 500, tracking: dataSize * 0.05, align: 'center', adaptive: true });
    return;
  }
  // whisper hem tab, legible on any garment colour
  drawLabel(ctx, `LUPI · ${d.name.toUpperCase()} · ${d.formula}`, w / 2, h * 0.955,
    { font: 'mono', size: w * 0.0165, weight: 400, tracking: w * 0.0165 * 0.24, color: LUPI_PALETTE.bone, align: 'center', adaptive: true });
}

/** Cap — transparent micro-emblem for the small front panel. */
function paintCap(ctx: CanvasRenderingContext2D, w: number, h: number, molecule: CanvasImageSource, d: MoleculeDescriptor, look: Look) {
  const p = look.placement;
  const cx = w * p.anchor[0];
  const cy = h * p.anchor[1];
  drawMoleculeScaled(ctx, molecule, cx, cy, p.scale * w);
  drawFormula(ctx, d.formulaParts, cx, h * 0.9, { size: h * 0.075, color: LUPI_PALETTE.bone, weight: 500, tracking: h * 0.075 * 0.05, align: 'center', adaptive: true });
}

// ─── public compose API ─────────────────────────────────────────────

/** Compose the Gooten print file for one product variant. */
export async function composePrintFile(
  molecule: CanvasImageSource,
  product: MerchProduct,
  variant: MerchVariant,
  descriptor: MoleculeDescriptor,
): Promise<ComposeResult & { spec: GootenPrintSpec }> {
  await ensureBrandFonts();
  const spec = printSpecFor(product, variant);
  const { canvas, ctx } = newCanvas(spec.widthPx, spec.heightPx);
  const w = canvas.width;
  const h = canvas.height;
  const look = assignLook(descriptor.name, product.id);

  if (spec.background !== 'transparent') {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.clearRect(0, 0, w, h);
  }

  switch (product.id) {
    case 'poster': paintPoster(ctx, w, h, molecule, descriptor, look); break;
    case 'mug': paintMug(ctx, w, h, molecule, descriptor, look, spec.safeMargin); break;
    case 'tee': paintTee(ctx, w, h, molecule, descriptor, look); break;
    case 'hat': paintCap(ctx, w, h, molecule, descriptor, look); break;
    default: paintTee(ctx, w, h, molecule, descriptor, look); break;
  }

  const blob = await canvasToPngBlob(canvas);
  return { blob, width: w, height: h, spec };
}

/** Compose the square flat-lay storefront tile for a product. */
export async function composeMockup(
  molecule: CanvasImageSource,
  product: MerchProduct,
  descriptor: MoleculeDescriptor,
): Promise<ComposeResult> {
  await ensureBrandFonts();
  const size = product.mockup.size;
  const { canvas, ctx } = newCanvas(size, size);
  drawGarmentMockup(ctx, size, product.id, molecule, descriptor);
  const blob = await canvasToPngBlob(canvas);
  return { blob, width: size, height: size };
}

/** Both assets for a product in one call, using the first variant's print spec. */
export async function composeForProduct(
  molecule: CanvasImageSource,
  product: MerchProduct,
  descriptor: MoleculeDescriptor,
): Promise<{ printFile: ComposeResult & { spec: GootenPrintSpec }; mockup: ComposeResult }> {
  const firstVariant = product.buildVariants()[0];
  const [printFile, mockup] = await Promise.all([
    composePrintFile(molecule, product, firstVariant, descriptor),
    composeMockup(molecule, product, descriptor),
  ]);
  return { printFile, mockup };
}
