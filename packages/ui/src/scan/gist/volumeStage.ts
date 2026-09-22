import {
  buildVolume,
  fillSmallHoles,
  frameMask,
  largestComponent,
  maskFeatures,
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
 * contrasts are measured and judged in parallel, the one that reads as the
 * subject wins, and its depth model and fatness rebuild the volume.
 */
export interface MaskCandidate {
  threshold: number;
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
  /** The object's own colours: its mean, and a lighter accent of it, for the particles that wear the palette. */
  palette: [string, string];
}

/** The mean colour of the object's pixels and a lighter accent, as hex. */
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
  const main = `#${hex(r / count)}${hex(g / count)}${hex(b / count)}`;
  const accent = `#${hex((r / count) * 0.7 + 90)}${hex((g / count) * 0.7 + 90)}${hex((b / count) * 0.7 + 90)}`;
  return [main, accent];
}

/** Contrast thresholds the candidates are cut at; the middle one is the default before Jev answers. */
export const MASK_THRESHOLDS = [55, 75, 100, 130];
export const DEFAULT_THRESHOLD = 75;

/** Cut a mask at one contrast against the border's median colour, keep the largest piece, close small holes. */
export function cutMask(pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, threshold: number): MaskCandidate {
  const { width, height, data } = pixels;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const border = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    reds.push(data[at]);
    greens.push(data[at + 1]);
    blues.push(data[at + 2]);
  };
  for (let x = 0; x < width; x += 1) {
    border(x, 0);
    border(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    border(0, y);
    border(width - 1, y);
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  const bg = [median(reds), median(greens), median(blues)];
  const raw = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const distance = Math.abs(data[at] - bg[0]) + Math.abs(data[at + 1] - bg[1]) + Math.abs(data[at + 2] - bg[2]);
      const centred = Math.hypot((x / width - 0.5) * 2, (y / height - 0.5) * 2) < 0.55;
      if (distance > (centred ? threshold : threshold * 1.5)) raw[y * width + x] = 1;
    }
  }
  const { mask, components } = largestComponent({ width, height, data: raw });
  const cleaned = fillSmallHoles(mask);
  return { threshold, mask: cleaned, features: maskFeatures(cleaned, components) };
}

function usable(candidate: MaskCandidate): boolean {
  return candidate.features.fill >= 0.02 && candidate.features.fill <= 0.92;
}

/** Everything the stage needs from a photo, right now, on the device. */
export function stageFromPhoto(pixels: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, threshold = DEFAULT_THRESHOLD, depth: DepthModel = 'inflate', fatness = FATNESS.round): VolumeStage {
  let candidate = cutMask(pixels, threshold);
  let masked = usable(candidate);
  if (!masked) {
    // Nothing stood out: the whole frame is the object.
    const all = new Uint8Array(pixels.width * pixels.height).fill(1);
    candidate = { threshold, mask: { width: pixels.width, height: pixels.height, data: all }, features: maskFeatures({ width: pixels.width, height: pixels.height, data: all }, 1) };
    masked = false;
  }
  const sheet = { width: (PHOTO_SHEET.height * pixels.width) / Math.max(pixels.height, 1), height: PHOTO_SHEET.height };
  const frame = frameMask(candidate.features, sheet);
  const volume = buildVolume(candidate.mask, { depth, fatness, sheet, ...frame });
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
  judged: Array<{ threshold: number; reply: RecipeReply; features: MaskFeatures }>;
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
  const candidates = MASK_THRESHOLDS.map((threshold) => cutMask(pixels, threshold)).filter(usable);
  if (candidates.length === 0) return null;
  const replies = await Promise.all(candidates.map((candidate) => requestRecipe(subject, { ...candidate.features, threshold: candidate.threshold }, signal)));
  if (replies.some((reply) => reply?.configured === false)) return { stage: stageFromPhoto(pixels), winner: { configured: false }, judged: [], configured: false };
  const judged = candidates
    .map((candidate, index) => ({ threshold: candidate.threshold, reply: replies[index], features: candidate.features }))
    .filter((entry): entry is { threshold: number; reply: RecipeReply; features: MaskFeatures } => Boolean(entry.reply && typeof entry.reply.reads === 'number'))
    .sort((a, b) => (b.reply.reads ?? 0) - (a.reply.reads ?? 0));
  if (judged.length === 0) return null;
  const best = judged[0];
  const depth = best.reply.depth?.choice ?? 'inflate';
  const fatness = FATNESS[best.reply.fatness?.choice ?? 'round'];
  return { stage: stageFromPhoto(pixels, best.threshold, depth, fatness), winner: best.reply, judged, configured: true };
}
