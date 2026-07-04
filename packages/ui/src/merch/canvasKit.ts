/**
 * canvasKit — shared 2D compositing primitives for the merch design system:
 * colour maths, the cosmic ground / aura / orbit / grain treatments, molecule
 * placement, and the Lupi typography (tracked display + subscript formula).
 *
 * Both printComposer (production print files + storefront tiles) and garments
 * (flat-lay lookbook mockups) build on these, so the two stay visually identical
 * without importing each other. Browser canvas only.
 */

import { LUPI_FONTS } from './artDirection';
import type { FormulaPart } from './artDirection';

// ─── image utilities ────────────────────────────────────────────────

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load molecule image for compositing.'));
    img.src = src;
  });
}

/** Crop a rendered molecule to its opaque bounding box (aspect preserved). */
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
  if (maxX < minX) return scratch;

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  out.getContext('2d')?.drawImage(scratch, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encode failed.'))), 'image/png');
  });
}

export function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas context for compositing.');
  return { canvas, ctx };
}

export interface ComposeResult { blob: Blob; width: number; height: number; }

// ─── colour ─────────────────────────────────────────────────────────

export interface Rgb { r: number; g: number; b: number; }

export function parseHex(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
  }
  const s = /^#?([0-9a-f]{3})$/i.exec(hex.trim());
  if (s) {
    const c = s[1];
    return { r: parseInt(c[0] + c[0], 16), g: parseInt(c[1] + c[1], 16), b: parseInt(c[2] + c[2], 16) };
  }
  return { r: 120, g: 140, b: 160 };
}

export function rgba({ r, g, b }: Rgb, a: number): string { return `rgba(${r}, ${g}, ${b}, ${a})`; }

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

export function shade(hex: string, amount: number): string {
  const c = parseHex(hex);
  const target: Rgb = amount >= 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  return rgbToHex(mix(c, target, Math.abs(amount)));
}

function rgbToHex({ r, g, b }: Rgb): string {
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function luminous(accent: Rgb): Rgb { return mix(accent, { r: 255, g: 250, b: 236 }, 0.4); }

/** Perceived luminance 0..1 — used to decide light-on-dark vs dark-on-light. */
export function luminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// ─── grain ──────────────────────────────────────────────────────────

let grainTile: HTMLCanvasElement | null = null;
function grainPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
  if (!grainTile) {
    const size = 128;
    grainTile = document.createElement('canvas');
    grainTile.width = size;
    grainTile.height = size;
    const gctx = grainTile.getContext('2d');
    if (!gctx) return null;
    const img = gctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);
  }
  return ctx.createPattern(grainTile, 'repeat');
}

export function drawGrain(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) {
  const pattern = grainPattern(ctx);
  if (!pattern) return;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ─── grounds / aura / orbit ─────────────────────────────────────────

export function fillVertical(ctx: CanvasRenderingContext2D, w: number, h: number, topHex: string, bottomHex: string) {
  const top = parseHex(topHex);
  const bottom = parseHex(bottomHex);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, rgba(top, 1));
  grad.addColorStop(0.62, rgba(mix(top, bottom, 0.55), 1));
  grad.addColorStop(1, rgba(bottom, 1));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

export function drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number, cx: number, cy: number, strength = 0.55) {
  const r = Math.hypot(w, h) * 0.62;
  const grad = ctx.createRadialGradient(cx, cy, r * 0.35, cx, cy, r);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

export function drawAura(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, accentHex: string, strength = 1) {
  const accent = parseHex(accentHex);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  halo.addColorStop(0, rgba(accent, 0.28 * strength));
  halo.addColorStop(0.4, rgba(accent, 0.12 * strength));
  halo.addColorStop(1, rgba(accent, 0));
  ctx.fillStyle = halo;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.42);
  const lum = luminous(accent);
  core.addColorStop(0, rgba(lum, 0.22 * strength));
  core.addColorStop(1, rgba(lum, 0));
  ctx.fillStyle = core;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.restore();
}

export function drawOrbit(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, accentHex: string, alpha: number, tilt = -0.32) {
  const accent = parseHex(accentHex);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(mix(accent, { r: 236, g: 230, b: 216 }, 0.35), alpha);
  ctx.lineWidth = Math.max(1, rx * 0.0022);
  ctx.stroke();
  ctx.restore();
}

// ─── molecule placement ─────────────────────────────────────────────

export interface Box { x: number; y: number; w: number; h: number; }

/** Fit the (trimmed) molecule inside a box, centred, aspect preserved. */
export function drawMoleculeInBox(
  ctx: CanvasRenderingContext2D,
  molecule: CanvasImageSource,
  box: Box,
  opts: { shadow?: number } = {},
): { cx: number; cy: number; drawW: number; drawH: number } {
  const srcW = (molecule as HTMLImageElement).width || box.w;
  const srcH = (molecule as HTMLImageElement).height || box.h;
  const scale = Math.min(box.w / srcW, box.h / srcH);
  return paintMolecule(ctx, molecule, box.x + box.w / 2, box.y + box.h / 2, srcW * scale, srcH * scale, opts);
}

/**
 * Place the molecule centred at (cx,cy) sized to `drawW` on the long side.
 * Scale is expressed against a reference width so callers can push extremes
 * (oversized > reference = intentional crop/bleed).
 */
export function drawMoleculeScaled(
  ctx: CanvasRenderingContext2D,
  molecule: CanvasImageSource,
  cx: number,
  cy: number,
  targetLongEdge: number,
  opts: { shadow?: number } = {},
): { cx: number; cy: number; drawW: number; drawH: number } {
  const srcW = (molecule as HTMLImageElement).width || targetLongEdge;
  const srcH = (molecule as HTMLImageElement).height || targetLongEdge;
  const scale = targetLongEdge / Math.max(srcW, srcH);
  return paintMolecule(ctx, molecule, cx, cy, srcW * scale, srcH * scale, opts);
}

function paintMolecule(
  ctx: CanvasRenderingContext2D,
  molecule: CanvasImageSource,
  cx: number,
  cy: number,
  drawW: number,
  drawH: number,
  opts: { shadow?: number },
) {
  ctx.save();
  (ctx as CanvasRenderingContext2D & { imageSmoothingQuality?: ImageSmoothingQuality }).imageSmoothingQuality = 'high';
  ctx.imageSmoothingEnabled = true;
  if (opts.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = opts.shadow;
    ctx.shadowOffsetY = opts.shadow * 0.28;
  }
  ctx.drawImage(molecule, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
  ctx.restore();
  return { cx, cy, drawW, drawH };
}

// ─── typography ─────────────────────────────────────────────────────

export type FontRole = 'display' | 'mono';

export interface LabelStyle {
  font: FontRole;
  size: number;
  weight?: number | string;
  italic?: boolean;
  tracking?: number;
  color: string;
  align?: 'left' | 'center' | 'right';
  /** Render for an unknown substrate (light fill + dark halo). */
  adaptive?: boolean;
}

export function applyFont(ctx: CanvasRenderingContext2D, s: Pick<LabelStyle, 'font' | 'size' | 'weight' | 'italic'>) {
  const family = s.font === 'display' ? LUPI_FONTS.display : LUPI_FONTS.mono;
  ctx.font = `${s.italic ? 'italic ' : ''}${s.weight ?? 400} ${s.size}px ${family}`;
  ctx.textBaseline = 'alphabetic';
}

export function trackedWidth(ctx: CanvasRenderingContext2D, text: string, tracking: number): number {
  let w = 0;
  for (const ch of text) w += ctx.measureText(ch).width + tracking;
  return text.length ? w - tracking : 0;
}

export function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, s: LabelStyle): number {
  applyFont(ctx, s);
  const tracking = s.tracking ?? 0;
  const total = trackedWidth(ctx, text, tracking);
  const startX = s.align === 'center' ? x - total / 2 : s.align === 'right' ? x - total : x;
  ctx.save();
  ctx.textAlign = 'left';
  if (s.adaptive) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = s.size * 0.22; }
  ctx.fillStyle = s.color;
  let cx = startX;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
  ctx.restore();
  return total;
}

export function drawFormula(
  ctx: CanvasRenderingContext2D,
  parts: FormulaPart[],
  x: number,
  y: number,
  s: Omit<LabelStyle, 'font'> & { tracking?: number },
): number {
  const subSize = s.size * 0.64;
  const subDrop = s.size * 0.16;
  const tracking = s.tracking ?? 0;
  const base = { font: 'mono' as const, size: s.size, weight: s.weight ?? 500 };
  const sub = { font: 'mono' as const, size: subSize, weight: s.weight ?? 500 };

  let total = 0;
  for (const p of parts) {
    applyFont(ctx, base); total += trackedWidth(ctx, p.symbol, tracking);
    if (p.count > 1) { applyFont(ctx, sub); total += trackedWidth(ctx, String(p.count), tracking) + tracking; }
    total += tracking * 1.4;
  }
  total = Math.max(0, total - tracking * 1.4);

  let cx = s.align === 'center' ? x - total / 2 : s.align === 'right' ? x - total : x;
  ctx.save();
  ctx.textAlign = 'left';
  if (s.adaptive) { ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = s.size * 0.22; }
  ctx.fillStyle = s.color;
  for (const p of parts) {
    applyFont(ctx, base);
    for (const ch of p.symbol) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + tracking; }
    if (p.count > 1) {
      applyFont(ctx, sub);
      for (const ch of String(p.count)) { ctx.fillText(ch, cx, y + subDrop); cx += ctx.measureText(ch).width + tracking; }
      cx += tracking;
    }
    cx += tracking * 1.4;
  }
  ctx.restore();
  return total;
}

export function fitDisplaySize(ctx: CanvasRenderingContext2D, text: string, maxW: number, baseSize: number, weight: number, tracking: number): number {
  applyFont(ctx, { font: 'display', size: baseSize, weight });
  const w = trackedWidth(ctx, text, tracking);
  if (w <= maxW) return baseSize;
  return Math.max(baseSize * 0.4, baseSize * (maxW / w));
}

export function drawHairline(ctx: CanvasRenderingContext2D, x1: number, x2: number, y: number, colorHex: string, weight: number, alpha = 0.9) {
  const c = parseHex(colorHex);
  const grad = ctx.createLinearGradient(x1, 0, x2, 0);
  grad.addColorStop(0, rgba(c, 0));
  grad.addColorStop(0.12, rgba(c, alpha));
  grad.addColorStop(0.88, rgba(c, alpha));
  grad.addColorStop(1, rgba(c, 0));
  ctx.save();
  ctx.strokeStyle = grad;
  ctx.lineWidth = weight;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

export function drawRegistrationTicks(ctx: CanvasRenderingContext2D, w: number, h: number, inset: number, colorHex: string, alpha = 0.5) {
  const c = parseHex(colorHex);
  const len = Math.min(w, h) * 0.028;
  ctx.save();
  ctx.strokeStyle = rgba(c, alpha);
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.0016);
  const corners: Array<[number, number, number, number]> = [
    [inset, inset, 1, 1], [w - inset, inset, -1, 1],
    [inset, h - inset, 1, -1], [w - inset, h - inset, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + len * sx, y);
    ctx.moveTo(x, y); ctx.lineTo(x, y + len * sy);
    ctx.stroke();
  }
  ctx.restore();
}

export function wrapMono(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, tracking: number, maxLines = 3): string[] {
  applyFont(ctx, { font: 'mono', size, weight: 400 });
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (trackedWidth(ctx, trial, tracking) > maxW && line) { lines.push(line); line = word; }
    else line = trial;
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

/** A soft, blurred contact shadow under a filled path (call before the shape). */
export function drawContactShadow(ctx: CanvasRenderingContext2D, path: Path2D, blur: number, offsetY: number, alpha = 0.28) {
  ctx.save();
  ctx.shadowColor = `rgba(20,18,16,${alpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = offsetY;
  ctx.fillStyle = 'rgba(0,0,0,1)';
  ctx.fill(path);
  ctx.restore();
}
