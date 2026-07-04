/**
 * garments — the flat-lay lookbook engine. Instead of a molecule floating on a
 * tint, the storefront tile shows the piece the way The Row shoots a lookbook:
 * a single garment on a warm studio ground, with the molecule composited onto
 * it at the exact placement and scale the print file uses. That makes the store
 * grid communicate the design language directly — the tee's oversized specimen,
 * the cap's micro-emblem, the mug's wrap, the poster's framed print.
 *
 * Everything is drawn with canvas paths (no external art) so it renders
 * identically in the headless CLI and in the browser. Silhouettes are stylised,
 * matte, and quiet — the vivid molecule is the only loud thing in the frame.
 */

import { LUPI_PALETTE, assignLook, type Look, type MoleculeDescriptor, type Placement } from './artDirection';
import {
  type Box,
  drawAura,
  drawContactShadow,
  drawFormula,
  drawLabel,
  drawMoleculeScaled,
  drawVignette,
  fillVertical,
  luminance,
  mix,
  parseHex,
  rgba,
  shade,
} from './canvasKit';

export type Colorway = 'ink' | 'bone' | 'clay' | 'ceramic';

const COLORWAY_HEX: Record<Colorway, string> = {
  ink: LUPI_PALETTE.garmentInk,
  bone: LUPI_PALETTE.garmentBone,
  clay: LUPI_PALETTE.garmentClay,
  ceramic: LUPI_PALETTE.ceramic,
};

/** Lookbook caption per product×look — names the piece like a collection. */
const LOOKBOOK_CAPTION: Record<string, Record<string, string>> = {
  tee: { grand: 'Grand Specimen Tee', pocket: 'Pocket Specimen Tee' },
  hat: { micro: 'Micro-Emblem Trucker' },
  mug: { wrap: 'Wrap Specimen Mug', mark: 'Single-Mark Mug' },
  poster: { specimen: 'Gallery Specimen Print', colossal: 'Colossal Crop Print' },
};

// ─── shared framing ─────────────────────────────────────────────────

function studioGround(ctx: CanvasRenderingContext2D, size: number) {
  fillVertical(ctx, size, size, LUPI_PALETTE.studioTop, LUPI_PALETTE.studioBottom);
  drawVignette(ctx, size, size, size / 2, size * 0.4, 0.16);
}

/** Ink or bone text depending on the surface it sits on. */
function readableOn(hex: string): string {
  return luminance(hex) > 0.5 ? LUPI_PALETTE.ink : LUPI_PALETTE.bone;
}

/** Lookbook caption + corner wordmark that frames every tile. */
function tileFraming(ctx: CanvasRenderingContext2D, size: number, product: string, look: Look, d: MoleculeDescriptor) {
  const ink = LUPI_PALETTE.ink;
  const muted = LUPI_PALETTE.inkMuted;
  // top-left wordmark
  drawLabel(ctx, 'LUPI', size * 0.06, size * 0.075, { font: 'mono', size: size * 0.019, weight: 500, tracking: size * 0.019 * 0.42, color: ink, align: 'left' });
  drawLabel(ctx, 'MOLECULAR EDITIONS', size * 0.06, size * 0.098, { font: 'mono', size: size * 0.0125, weight: 400, tracking: size * 0.0125 * 0.3, color: muted, align: 'left' });
  // top-right accent chip + atom count
  const chip = size * 0.014;
  ctx.save();
  ctx.fillStyle = d.accent;
  ctx.beginPath();
  ctx.arc(size * 0.9, size * 0.084, chip / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  drawLabel(ctx, `${d.atomCount} ATOMS`, size * 0.905, size * 0.088, { font: 'mono', size: size * 0.0125, weight: 400, tracking: size * 0.0125 * 0.28, color: muted, align: 'left' });

  // bottom caption: name + product line + formula
  const capY = size * 0.94;
  drawLabel(ctx, d.name, size * 0.06, capY, { font: 'display', size: size * 0.042, weight: 400, tracking: size * 0.004, color: ink, align: 'left' });
  drawLabel(ctx, (LOOKBOOK_CAPTION[product]?.[look.name] ?? '').toUpperCase(), size * 0.06, capY + size * 0.026, { font: 'mono', size: size * 0.0135, weight: 400, tracking: size * 0.0135 * 0.3, color: muted, align: 'left' });
  drawFormula(ctx, d.formulaParts, size * 0.94, capY, { size: size * 0.03, weight: 500, color: ink, align: 'right', tracking: size * 0.03 * 0.02 });
}

/** Fabric volume: soft central lift + edge falloff, clipped to the garment.
 *  Strength scales with garment darkness — a dark tee needs a visible lift,
 *  a bone tee only a breath of it (otherwise the highlight reads as a glow). */
function fabricShading(ctx: CanvasRenderingContext2D, clip: Path2D, box: Box, garmentHex: string) {
  const darkness = 1 - luminance(garmentHex);
  const hiAlpha = 0.18 + 0.6 * darkness;
  const loAlpha = 0.16 + 0.4 * darkness;
  ctx.save();
  ctx.clip(clip);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h * 0.4;
  const hi = ctx.createRadialGradient(cx, cy, 0, cx, cy, box.w * 0.62);
  hi.addColorStop(0, rgba(parseHex(shade(garmentHex, 0.05)), hiAlpha));
  hi.addColorStop(0.6, 'rgba(0,0,0,0)');
  ctx.fillStyle = hi;
  ctx.fillRect(box.x - box.w, box.y - box.h, box.w * 3, box.h * 3);
  const lo = ctx.createRadialGradient(cx, box.y + box.h * 0.6, box.w * 0.25, cx, box.y + box.h * 0.6, box.w * 0.85);
  lo.addColorStop(0, 'rgba(0,0,0,0)');
  lo.addColorStop(1, rgba(parseHex(shade(garmentHex, -0.12)), loAlpha));
  ctx.fillStyle = lo;
  ctx.fillRect(box.x - box.w, box.y - box.h, box.w * 3, box.h * 3);
  ctx.restore();
}

interface PlacedMolecule { molecule: CanvasImageSource; descriptor: MoleculeDescriptor; }

/**
 * Composite the molecule at its placement, clipped to a garment region. The
 * anchor/scale are read against `printArea` — the region of the garment the
 * production print file maps onto — so the mockup shows the true placement.
 */
function placeMolecule(ctx: CanvasRenderingContext2D, clip: Path2D, printArea: Box, placement: Placement, mol: PlacedMolecule, opts: { aura?: number } = {}): { mx: number; my: number; target: number } {
  const mx = printArea.x + placement.anchor[0] * printArea.w;
  const my = printArea.y + placement.anchor[1] * printArea.h;
  const target = placement.scale * printArea.w;
  ctx.save();
  ctx.clip(clip);
  if (opts.aura) drawAura(ctx, mx, my, target * 0.62, mol.descriptor.accent, opts.aura);
  drawMoleculeScaled(ctx, mol.molecule, mx, my, target, { shadow: printArea.w * 0.02 });
  ctx.restore();
  return { mx, my, target };
}

// ─── tee (oversized specimen) ───────────────────────────────────────

function buildTee(bx: number, by: number, bw: number, bh: number): { silhouette: Path2D; body: Path2D; box: Box; cx: number; neckHalf: number; shoulderY: number; collarCtrlY: number } {
  const cx = bx + bw / 2;
  // Modern oversized flat-lay: dropped, rounded shoulders; sleeves angled down;
  // a gently tapered boxy body.
  const neckHalf = 0.078 * bw;
  const shoulderY = by + 0.075 * bh;
  const shoulderSeam = 0.2 * bw;      // half body top width
  const sleeveTipX = 0.45 * bw;       // half distance to sleeve tip
  const sleeveTipTopY = by + 0.055 * bh;
  const sleeveHemOuterX = 0.435 * bw;
  const sleeveHemY = by + 0.31 * bh;
  const underarmX = 0.235 * bw;
  const underarmY = by + 0.34 * bh;
  const hemX = 0.25 * bw;
  const hemY = by + 0.99 * bh;
  const waistY = by + 0.66 * bh;
  const collarCtrlY = shoulderY + 0.085 * bh;

  const silhouette = new Path2D();
  silhouette.moveTo(cx - neckHalf, shoulderY);
  silhouette.quadraticCurveTo(cx - shoulderSeam, shoulderY - 0.008 * bh, cx - sleeveTipX, sleeveTipTopY);
  silhouette.lineTo(cx - sleeveHemOuterX, sleeveHemY);
  silhouette.lineTo(cx - underarmX, underarmY);
  silhouette.quadraticCurveTo(cx - hemX, waistY, cx - hemX, hemY);
  silhouette.lineTo(cx + hemX, hemY);
  silhouette.quadraticCurveTo(cx + hemX, waistY, cx + underarmX, underarmY);
  silhouette.lineTo(cx + sleeveHemOuterX, sleeveHemY);
  silhouette.lineTo(cx + sleeveTipX, sleeveTipTopY);
  silhouette.quadraticCurveTo(cx + shoulderSeam, shoulderY - 0.008 * bh, cx + neckHalf, shoulderY);
  silhouette.quadraticCurveTo(cx, collarCtrlY, cx - neckHalf, shoulderY);
  silhouette.closePath();

  const body = new Path2D();
  body.moveTo(cx - neckHalf, shoulderY);
  body.lineTo(cx - shoulderSeam, shoulderY + 0.004 * bh);
  body.lineTo(cx - underarmX, underarmY);
  body.quadraticCurveTo(cx - hemX, waistY, cx - hemX, hemY);
  body.lineTo(cx + hemX, hemY);
  body.quadraticCurveTo(cx + hemX, waistY, cx + underarmX, underarmY);
  body.lineTo(cx + shoulderSeam, shoulderY + 0.004 * bh);
  body.lineTo(cx + neckHalf, shoulderY);
  body.quadraticCurveTo(cx, collarCtrlY, cx - neckHalf, shoulderY);
  body.closePath();

  return { silhouette, body, box: { x: bx, y: by, w: bw, h: bh }, cx, neckHalf, shoulderY, collarCtrlY };
}

function drawTee(ctx: CanvasRenderingContext2D, size: number, look: Look, mol: PlacedMolecule) {
  const bw = size * 0.84;
  const bh = size * 0.72;
  const bx = (size - bw) / 2;
  const by = size * 0.125;
  const garment = COLORWAY_HEX[look.colorway];
  const { silhouette, body, box, cx, neckHalf, shoulderY, collarCtrlY } = buildTee(bx, by, bw, bh);

  drawContactShadow(ctx, silhouette, size * 0.05, size * 0.018, 0.26);
  ctx.fillStyle = garment;
  ctx.fill(silhouette);
  fabricShading(ctx, silhouette, box, garment);

  // ribbed crew collar (a second crescent just inside the neckline)
  const seam = rgba(parseHex(shade(garment, luminance(garment) > 0.5 ? -0.18 : 0.24)), 0.6);
  ctx.save();
  ctx.strokeStyle = seam;
  ctx.lineWidth = Math.max(1.6, size * 0.0024);
  ctx.beginPath();
  ctx.moveTo(cx - neckHalf * 1.25, shoulderY);
  ctx.quadraticCurveTo(cx, collarCtrlY + size * 0.012, cx + neckHalf * 1.25, shoulderY);
  ctx.stroke();
  ctx.restore();

  // chest print area — the region the production print file maps onto
  const printW = bw * 0.5;
  const printArea: Box = { x: cx - printW / 2, y: by + bh * 0.17, w: printW, h: printW * 1.2 };
  const placed = placeMolecule(ctx, body, printArea, look.placement, mol);

  const labelColor = rgba(parseHex(readableOn(garment)), 0.62);
  if (look.name === 'pocket') {
    // pocket mark carries its own tiny formula caption, like the print file
    const dataSize = placed.target * 0.13;
    ctx.save();
    ctx.clip(body);
    drawFormula(ctx, mol.descriptor.formulaParts, placed.mx, placed.my + placed.target * 0.62 + dataSize,
      { size: dataSize, weight: 500, color: readableOn(garment), align: 'center', tracking: dataSize * 0.05 });
    ctx.restore();
  } else {
    // whisper hem label (a care-tab, not a logo)
    drawLabel(ctx, `LUPI · ${mol.descriptor.name.toUpperCase()} · ${mol.descriptor.formula}`, cx, by + bh * 0.955,
      { font: 'mono', size: size * 0.0135, weight: 400, tracking: size * 0.0135 * 0.24, color: labelColor, align: 'center' });
  }
}

// ─── cap (micro-emblem) ─────────────────────────────────────────────

function drawCap(ctx: CanvasRenderingContext2D, size: number, look: Look, mol: PlacedMolecule) {
  const bw = size * 0.6;
  const bh = size * 0.46;
  const bx = (size - bw) / 2;
  const by = size * 0.19;
  const cx = bx + bw / 2;
  const garment = COLORWAY_HEX[look.colorway];
  const crownHalf = 0.42 * bw;
  const crownBottomY = by + 0.6 * bh;

  const crown = new Path2D();
  crown.moveTo(cx - crownHalf, crownBottomY);
  crown.bezierCurveTo(cx - crownHalf, by + 0.04 * bh, cx - crownHalf * 0.5, by, cx, by);
  crown.bezierCurveTo(cx + crownHalf * 0.5, by, cx + crownHalf, by + 0.04 * bh, cx + crownHalf, crownBottomY);
  crown.closePath();

  const bill = new Path2D();
  bill.moveTo(cx - crownHalf * 0.82, crownBottomY);
  bill.lineTo(cx + crownHalf * 0.82, crownBottomY);
  bill.quadraticCurveTo(cx + crownHalf * 0.7, crownBottomY + 0.3 * bh, cx, crownBottomY + 0.36 * bh);
  bill.quadraticCurveTo(cx - crownHalf * 0.7, crownBottomY + 0.3 * bh, cx - crownHalf * 0.82, crownBottomY);
  bill.closePath();

  const whole = new Path2D();
  whole.addPath(bill);
  whole.addPath(crown);
  drawContactShadow(ctx, whole, size * 0.045, size * 0.016, 0.26);

  // bill (slightly darker), then crown
  ctx.fillStyle = shade(garment, -0.08);
  ctx.fill(bill);
  ctx.fillStyle = garment;
  ctx.fill(crown);
  fabricShading(ctx, crown, { x: bx, y: by, w: bw, h: bh }, garment);

  // bill topstitch + center seam
  const seam = rgba(parseHex(shade(garment, luminance(garment) > 0.5 ? -0.2 : 0.24)), 0.5);
  ctx.save();
  ctx.strokeStyle = seam;
  ctx.lineWidth = Math.max(1.2, size * 0.0016);
  ctx.beginPath();
  ctx.moveTo(cx - crownHalf * 0.7, crownBottomY + 0.05 * bh);
  ctx.quadraticCurveTo(cx, crownBottomY + 0.26 * bh, cx + crownHalf * 0.7, crownBottomY + 0.05 * bh);
  ctx.moveTo(cx, by + 0.04 * bh); ctx.lineTo(cx, crownBottomY);
  ctx.stroke();
  ctx.restore();

  // the micro-emblem — jewel-small, dead centre of the crown panel
  const printArea: Box = { x: cx - crownHalf, y: by, w: crownHalf * 2, h: crownBottomY - by };
  placeMolecule(ctx, crown, printArea, look.placement, mol);
}

// ─── mug (wrap specimen) ────────────────────────────────────────────

function drawMug(ctx: CanvasRenderingContext2D, size: number, look: Look, mol: PlacedMolecule) {
  const bw = size * 0.6;
  const bh = size * 0.5;
  const bx = size * 0.14;
  const by = size * 0.21;
  const garment = COLORWAY_HEX.ceramic;
  const bodyW = bw * 0.72;
  const bodyLeft = bx;
  const bodyRight = bx + bodyW;
  const bodyCx = (bodyLeft + bodyRight) / 2;
  const rimRy = bh * 0.06;

  const body = new Path2D();
  body.moveTo(bodyLeft, by);
  body.bezierCurveTo(bodyLeft - bw * 0.02, by + bh * 0.5, bodyLeft - bw * 0.02, by + bh * 0.5, bodyLeft, by + bh);
  body.ellipse(bodyCx, by + bh, bodyW / 2, rimRy, 0, Math.PI, 0, true);
  body.lineTo(bodyRight, by);
  body.ellipse(bodyCx, by, bodyW / 2, rimRy, 0, 0, Math.PI, false);
  body.closePath();

  // handle
  const handle = new Path2D();
  const hx = bodyRight - bw * 0.005;
  handle.ellipse(hx + bw * 0.11, by + bh * 0.42, bw * 0.13, bh * 0.2, 0, -Math.PI * 0.5, Math.PI * 0.5, false);

  drawContactShadow(ctx, body, size * 0.045, size * 0.016, 0.24);

  // handle stroke
  ctx.save();
  ctx.strokeStyle = shade(garment, -0.12);
  ctx.lineWidth = bw * 0.05;
  ctx.stroke(handle);
  ctx.restore();

  // cylinder body with left-light → right-shade volume
  const vol = ctx.createLinearGradient(bodyLeft, 0, bodyRight, 0);
  vol.addColorStop(0, shade(garment, -0.05));
  vol.addColorStop(0.32, shade(garment, 0.05));
  vol.addColorStop(1, shade(garment, -0.14));
  ctx.save();
  ctx.fillStyle = vol;
  ctx.fill(body);
  ctx.restore();

  // rim
  ctx.save();
  ctx.fillStyle = shade(garment, -0.2);
  ctx.beginPath();
  ctx.ellipse(bodyCx, by, bodyW / 2, rimRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(garment, 0.08);
  ctx.beginPath();
  ctx.ellipse(bodyCx, by + rimRy * 0.35, bodyW / 2 * 0.9, rimRy * 0.72, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // The two mug looks sit at opposite extremes. 'wrap': the specimen large on
  // the face, cropping at both edges so it reads as continuing around the
  // barrel. 'mark': one tiny molecule floating on all that ceramic.
  const faceCx = bodyCx;
  const faceCy = by + bh * (look.name === 'mark' ? 0.42 : 0.46);
  const target = look.name === 'mark' ? bodyW * 0.30 : bodyW * 0.98;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bodyLeft, by + rimRy, bodyW, bh - rimRy * 1.5);
  ctx.clip();
  drawAura(ctx, faceCx, faceCy, target * 0.5, mol.descriptor.accent, 0.32);
  ctx.translate(faceCx, faceCy);
  ctx.scale(0.92, 1);
  drawMoleculeScaled(ctx, mol.molecule, 0, 0, target, { shadow: bodyW * 0.02 });
  ctx.restore();
  // tiny ink formula on the face
  const formulaY = look.name === 'mark' ? faceCy + target * 0.75 + bh * 0.05 : by + bh * 0.92;
  drawFormula(ctx, mol.descriptor.formulaParts, bodyCx, formulaY,
    { size: bh * 0.05, weight: 500, color: LUPI_PALETTE.ink, align: 'center', tracking: bh * 0.05 * 0.03 });
}

// ─── poster (framed gallery specimen) ───────────────────────────────

function drawPosterFrame(ctx: CanvasRenderingContext2D, size: number, look: Look, mol: PlacedMolecule) {
  const placement = look.placement;
  const fw = size * 0.5;
  const fh = size * 0.7;
  const fx = (size - fw) / 2;
  const fy = size * 0.135;

  const frame = new Path2D();
  frame.rect(fx, fy, fw, fh);
  drawContactShadow(ctx, frame, size * 0.05, size * 0.02, 0.3);

  // moulding
  ctx.fillStyle = LUPI_PALETTE.frameMoulding;
  ctx.fillRect(fx, fy, fw, fh);
  // mat
  const mat = fw * 0.055;
  ctx.fillStyle = LUPI_PALETTE.garmentBone;
  ctx.fillRect(fx + mat, fy + mat, fw - mat * 2, fh - mat * 2);
  // art window
  const aw = fw * 0.1;
  const ax = fx + aw, ay = fy + aw, awW = fw - aw * 2, awH = fh - aw * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ax, ay, awW, awH);
  ctx.clip();
  const top = parseHex(LUPI_PALETTE.groundTop);
  const bottom = parseHex(LUPI_PALETTE.groundBottom);
  const g = ctx.createLinearGradient(0, ay, 0, ay + awH);
  g.addColorStop(0, rgba(top, 1));
  g.addColorStop(1, rgba(bottom, 1));
  ctx.fillStyle = g;
  ctx.fillRect(ax, ay, awW, awH);
  // specimen at the look's placement — 'colossal' intentionally crops
  const mx = ax + placement.anchor[0] * awW;
  const my = ay + placement.anchor[1] * awH;
  drawAura(ctx, mx, my, Math.min(placement.scale * awW * 0.5, awW * 0.6), mol.descriptor.accent, look.name === 'colossal' ? 0.7 : 1);
  drawMoleculeScaled(ctx, mol.molecule, mx, my, placement.scale * awW, { shadow: awW * 0.02 });
  // caption inside the print
  if (look.name === 'colossal') {
    drawLabel(ctx, mol.descriptor.name, ax + awW * 0.08, ay + awH * 0.94, { font: 'display', size: awW * 0.07, weight: 380, tracking: awW * 0.004, color: LUPI_PALETTE.bone, align: 'left' });
    drawFormula(ctx, mol.descriptor.formulaParts, ax + awW * 0.92, ay + awH * 0.94, { size: awW * 0.042, weight: 500, color: LUPI_PALETTE.boneMuted, align: 'right', tracking: awW * 0.042 * 0.04 });
  } else {
    drawLabel(ctx, mol.descriptor.name, ax + awW / 2, ay + awH * 0.9, { font: 'display', size: awW * 0.085, weight: 380, tracking: awW * 0.006, color: LUPI_PALETTE.bone, align: 'center' });
    drawFormula(ctx, mol.descriptor.formulaParts, ax + awW / 2, ay + awH * 0.955, { size: awW * 0.05, weight: 500, color: LUPI_PALETTE.boneMuted, align: 'center', tracking: awW * 0.05 * 0.04 });
  }
  ctx.restore();

  // inner moulding highlight
  ctx.save();
  ctx.strokeStyle = rgba(mix(parseHex(LUPI_PALETTE.frameMoulding), { r: 255, g: 255, b: 255 }, 0.25), 0.6);
  ctx.lineWidth = Math.max(1, size * 0.001);
  ctx.strokeRect(fx + mat, fy + mat, fw - mat * 2, fh - mat * 2);
  ctx.restore();
}

// ─── dispatcher ─────────────────────────────────────────────────────

/** Draw a full flat-lay lookbook tile (opaque) for one product. */
export function drawGarmentMockup(
  ctx: CanvasRenderingContext2D,
  size: number,
  productId: string,
  molecule: CanvasImageSource,
  descriptor: MoleculeDescriptor,
) {
  const look = assignLook(descriptor.name, productId);
  const mol: PlacedMolecule = { molecule, descriptor };

  studioGround(ctx, size);
  switch (productId) {
    case 'tee': drawTee(ctx, size, look, mol); break;
    case 'hat': drawCap(ctx, size, look, mol); break;
    case 'mug': drawMug(ctx, size, look, mol); break;
    case 'poster': drawPosterFrame(ctx, size, look, mol); break;
    default: drawTee(ctx, size, look, mol); break;
  }
  tileFraming(ctx, size, productId, look, descriptor);
}
