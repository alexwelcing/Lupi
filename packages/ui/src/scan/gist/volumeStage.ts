import {
  buildVolume,
  fillSmallHoles,
  floodMask,
  frameMask,
  largestComponent,
  maskFeatures,
  smoothRgb,
  type DepthModel,
  type MaskFeatures,
  type MaskImage,
  type Volume,
} from '@atlas/core/gist';
import { PHOTO_SHEET, type PhotoPixels } from './gistEngine';
import { FATNESS, requestRecipe, type RecipeReply } from './gistClient';

/**
 * The photo's own shape, with no model in the loop: mask, clean, measure,
 * frame, inflate. Then, with Jev, the recipe: several masks at different
 * flood tolerances are measured and judged in parallel, the one that reads as the
 * subject wins, and its depth model and fatness rebuild the volume.
 */
export interface MaskCandidate {
  /** The flood tolerance this mask was cut at. */
  tolerance: number;
  mask: MaskImage;
  features: MaskFeatures;
}

export interface VolumeStage {
  /** The photo's pixels with the winning mask and framing, for seeding the particles. */
  photo: PhotoPixels;
  candidate: MaskCandidate;
  volume: Volume;
  /** True when a mask stood out from the background; false means the whole frame is the object. */
  masked: boolean;
  /** The object's own colours: its mean, and that mean in shadow, for the particles that wear the palette. */
  palette: [string, string];
}

/** The mean colour of the object's pixels and the same in shadow, as hex. */
export function maskPalette(pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, mask: Uint8Array): [string, string] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    r += pixels.data[index * 4];
    g += pixels.data[index * 4 + 1];
    b += pixels.data[index * 4 + 2];
    count += 1;
  }
  if (count === 0) return ['#d5ef9c', '#84d7ff'];
  const hex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  // The accent is the same colour in shadow: the particles that wear the
  // palette are the ones on the object's sides and back, and a lighter tint
  // there reads as a halo, a darker one as the object turning away.
  const main = `#${hex(r / count)}${hex(g / count)}${hex(b / count)}`;
  const accent = `#${hex((r / count) * 0.62)}${hex((g / count) * 0.62)}${hex((b / count) * 0.66)}`;
  return [main, accent];
}

/**
 * Flood tolerances the candidates are cut at: the largest colour step the
 * background may take between neighbouring pixels. The second is the
 * default before Jev answers; the loosest crosses most texture.
 */
export const MASK_TOLERANCES = [12, 20, 32, 48];
export const DEFAULT_TOLERANCE = 20;

/** Cut a mask by flooding the background in from the border, keep the largest piece, close small holes. */
export function cutMask(pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, tolerance: number, smoothed?: Float32Array): MaskCandidate {
  const raw = floodMask(pixels, tolerance, smoothed);
  const { mask, components } = largestComponent(raw);
  const cleaned = fillSmallHoles(mask);
  return { tolerance, mask: cleaned, features: maskFeatures(cleaned, components) };
}

function usable(candidate: MaskCandidate): boolean {
  return candidate.features.fill >= 0.02 && candidate.features.fill <= 0.92;
}

/** Everything the stage needs from a photo, right now, on the device. */
export function stageFromPhoto(pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, tolerance = DEFAULT_TOLERANCE, depth: DepthModel = 'inflate', fatness = FATNESS.round, n?: number): VolumeStage {
  let candidate = cutMask(pixels, tolerance);
  let masked = usable(candidate);
  if (!masked) {
    // Nothing stood out: the whole frame is the object.
    const all = new Uint8Array(pixels.width * pixels.height).fill(1);
    candidate = { tolerance, mask: { width: pixels.width, height: pixels.height, data: all }, features: maskFeatures({ width: pixels.width, height: pixels.height, data: all }, 1) };
    masked = false;
  }
  const sheet = { width: (PHOTO_SHEET.height * pixels.width) / Math.max(pixels.height, 1), height: PHOTO_SHEET.height };
  const frame = frameMask(candidate.features, sheet);
  const volume = buildVolume(candidate.mask, { depth, fatness, sheet, n, ...frame });
  return {
    photo: { width: pixels.width, height: pixels.height, data: pixels.data, mask: candidate.mask.data, frame },
    candidate,
    volume,
    masked,
    palette: maskPalette(pixels, candidate.mask.data),
  };
}

export interface RecipeOutcome {
  stage: VolumeStage;
  winner: RecipeReply;
  /** Every judgment, best first, for the dev panel. */
  judged: Array<{ tolerance: number; reply: RecipeReply; features: MaskFeatures }>;
  configured: boolean;
}

/**
 * Cut the mask at every threshold, measure each, ask Jev about all of them
 * at once, and rebuild the stage from the winner with its depth and
 * fatness. Null when nothing answered.
 */
export async function chooseRecipe(
  pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array },
  subject: string,
  signal?: AbortSignal,
): Promise<RecipeOutcome | null> {
  const smoothed = smoothRgb(pixels);
  const candidates = MASK_TOLERANCES.map((tolerance) => cutMask(pixels, tolerance, smoothed)).filter(usable);
  if (candidates.length === 0) return null;
  const replies = await Promise.all(candidates.map((candidate) => requestRecipe(subject, { ...candidate.features, tolerance: candidate.tolerance }, signal)));
  if (replies.some((reply) => reply?.configured === false)) return { stage: stageFromPhoto(pixels), winner: { configured: false }, judged: [], configured: false };
  const judged = candidates
    .map((candidate, index) => ({ tolerance: candidate.tolerance, reply: replies[index], features: candidate.features }))
    .filter((entry): entry is { tolerance: number; reply: RecipeReply; features: MaskFeatures } => Boolean(entry.reply && typeof entry.reply.reads === 'number'))
    .sort((a, b) => (b.reply.reads ?? 0) - (a.reply.reads ?? 0));
  if (judged.length === 0) return null;
  const best = judged[0];
  const depth = best.reply.depth?.choice ?? 'inflate';
  const fatness = FATNESS[best.reply.fatness?.choice ?? 'round'];
  return { stage: stageFromPhoto(pixels, best.tolerance, depth, fatness), winner: best.reply, judged, configured: true };
}

/**
 * Decode a mask image (a data URL from SAM 3, white where the subject is)
 * to the size of the particle pixels. Anything brighter than mid-grey and
 * not transparent counts.
 */
export async function maskFromImage(dataUrl: string, width: number, height: number): Promise<MaskImage | null> {
  if (typeof document === 'undefined') return null;
  const bitmap = await new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
  if (!bitmap) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  let on = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const at = index * 4;
    // SAM 3's masks come as a coloured overlay (red on white) or as black and
    // white; either way the subject is the part that is not near-white.
    const bright = (data[at] + data[at + 1] + data[at + 2]) / 3;
    const saturated = Math.max(data[at], data[at + 1], data[at + 2]) - Math.min(data[at], data[at + 1], data[at + 2]);
    if (data[at + 3] > 64 && (saturated > 60 || bright < 128)) {
      mask[index] = 1;
      on += 1;
    }
  }
  if (on === 0) return null;
  return { width, height, data: mask };
}

/** A stage from a mask made elsewhere (SAM 3), on the same photo, keeping the recipe. */
export function stageFromMask(pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, given: MaskImage, tolerance: number, depth: DepthModel = 'inflate', fatness = FATNESS.round): VolumeStage {
  const { mask, components } = largestComponent(given);
  const cleaned = fillSmallHoles(mask);
  const candidate: MaskCandidate = { tolerance, mask: cleaned, features: maskFeatures(cleaned, components) };
  const sheet = { width: (PHOTO_SHEET.height * pixels.width) / Math.max(pixels.height, 1), height: PHOTO_SHEET.height };
  const frame = frameMask(candidate.features, sheet);
  const volume = buildVolume(candidate.mask, { depth, fatness, sheet, ...frame });
  return {
    photo: { width: pixels.width, height: pixels.height, data: pixels.data, mask: candidate.mask.data, frame },
    candidate,
    volume,
    masked: usable(candidate),
    palette: maskPalette(pixels, candidate.mask.data),
  };
}
