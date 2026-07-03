/**
 * printComposer — turns a rendered molecule PNG into the two assets a
 * print-on-demand listing needs:
 *
 *   • print file — the exact Gooten canvas (dims/DPI/background from the
 *     catalog) with the molecule placed as a centered medallion in the safe
 *     area. This is what Gooten prints onto the physical product.
 *   • mockup tile — a square storefront image (molecule on a product-tinted
 *     backdrop) used as the Shopify product photo until Gooten's real mockups
 *     sync in.
 *
 * Browser canvas only (2D compositing). The heavy 3D work already happened in
 * moleculePngRenderer; this is pure raster placement, so it is cheap and runs
 * anywhere a canvas exists — the Merch Studio, the export_merch MCP tool, and
 * the headless CLI all share it.
 */

import type { GootenPrintSpec, MerchProduct, MerchVariant } from './merchCatalog';
import { printSpecFor } from './merchCatalog';

/** Load a data/blob URL into an <img> ready to draw. */
export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load molecule image for compositing.'));
    img.src = src;
  });
}

/**
 * Crop a rendered molecule to its opaque bounding box, removing the transparent
 * margin the bounding-sphere fit leaves around a diagonal molecule. Placing the
 * *trimmed* mark means `medallionScale` genuinely controls how much of the
 * product it fills — otherwise the empty margin scales too and the design lands
 * small. Returns a tight canvas (may be non-square; aspect preserved).
 */
export function trimToContent(
  source: CanvasImageSource & { width: number; height: number },
  alphaThreshold = 8,
): HTMLCanvasElement {
  const w = source.width;
  const h = source.height;
  const scratch = document.createElement('canvas');
  scratch.width = w;
  scratch.height = h;
  const sctx = scratch.getContext('2d');
  if (!sctx) return scratch;
  sctx.drawImage(source, 0, 0);

  const data = sctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return scratch; // fully transparent — nothing to trim

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')?.drawImage(scratch, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed.'))), 'image/png');
  });
}

/**
 * Draw the (square, transparent) molecule medallion centered per spec. The
 * medallion spans `medallionScale` of the shorter canvas edge, inset by
 * `safeMargin`, so nothing lands in the wrap seam / trim bleed.
 */
function drawMedallion(
  ctx: CanvasRenderingContext2D,
  molecule: CanvasImageSource,
  canvasW: number,
  canvasH: number,
  medallionScale: number,
  center: [number, number],
  safeMargin: number,
) {
  const srcW = (molecule as HTMLImageElement).width || canvasW;
  const srcH = (molecule as HTMLImageElement).height || canvasH;
  const shorter = Math.min(canvasW, canvasH);
  const target = shorter * medallionScale * (1 - safeMargin * 2);
  const scale = target / Math.max(srcW, srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  const cx = canvasW * center[0];
  const cy = canvasH * center[1];
  (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(molecule, cx - w / 2, cy - h / 2, w, h);
}

export interface ComposeResult {
  blob: Blob;
  width: number;
  height: number;
}

/** Compose the Gooten print file for one product variant. */
export async function composePrintFile(
  molecule: CanvasImageSource,
  product: MerchProduct,
  variant: MerchVariant,
): Promise<ComposeResult & { spec: GootenPrintSpec }> {
  const spec = printSpecFor(product, variant);
  const canvas = document.createElement('canvas');
  canvas.width = spec.widthPx;
  canvas.height = spec.heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for print-file compositing.');

  if (spec.background !== 'transparent') {
    ctx.fillStyle = spec.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  drawMedallion(ctx, molecule, canvas.width, canvas.height, spec.medallionScale, spec.center, spec.safeMargin);

  const blob = await canvasToPngBlob(canvas);
  return { blob, width: canvas.width, height: canvas.height, spec };
}

/** Compose the square storefront mockup tile for a product. */
export async function composeMockup(
  molecule: CanvasImageSource,
  product: MerchProduct,
): Promise<ComposeResult> {
  const { size, background, medallionScale } = product.mockup;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D context for mockup compositing.');

  // Soft radial backdrop so the molecule reads as a product hero, not a raw cutout.
  const grad = ctx.createRadialGradient(size * 0.5, size * 0.44, size * 0.1, size * 0.5, size * 0.5, size * 0.72);
  grad.addColorStop(0, lighten(background, 0.10));
  grad.addColorStop(1, background);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  drawMedallion(ctx, molecule, size, size, medallionScale, [0.5, 0.48], 0.04);

  const blob = await canvasToPngBlob(canvas);
  return { blob, width: size, height: size };
}

/** Both assets for a product in one call, using the first variant's print spec. */
export async function composeForProduct(
  molecule: CanvasImageSource,
  product: MerchProduct,
): Promise<{ printFile: ComposeResult & { spec: GootenPrintSpec }; mockup: ComposeResult }> {
  const firstVariant = product.buildVariants()[0];
  const [printFile, mockup] = await Promise.all([
    composePrintFile(molecule, product, firstVariant),
    composeMockup(molecule, product),
  ]);
  return { printFile, mockup };
}

// ─── color helper ───────────────────────────────────────────────────
function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (n & 0xff) + Math.round(255 * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
