// Load a real photo for the headless tools, the way the page prepares one:
// a JPEG no larger than 1024 on its long edge for the models, and a small
// RGBA copy (160 px long edge) for the mask and the particles.
import { createCanvas, loadImage } from 'canvas';

export interface LoadedPhoto {
  pixels: { width: number; height: number; data: Uint8ClampedArray };
  jpeg: Buffer;
  width: number;
  height: number;
}

/**
 * A mask image (SAM 3's overlay, or black and white) at the pixels' size,
 * read the way the page's `maskFromImage` reads it: the subject is whatever
 * is not near-white and not transparent.
 */
export async function loadMaskFile(path: string, width: number, height: number): Promise<{ width: number; height: number; data: Uint8Array }> {
  const image = await loadImage(path);
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const at = index * 4;
    const bright = (data[at] + data[at + 1] + data[at + 2]) / 3;
    const saturated = Math.max(data[at], data[at + 1], data[at + 2]) - Math.min(data[at], data[at + 1], data[at + 2]);
    if (data[at + 3] > 64 && (saturated > 60 || bright < 128)) mask[index] = 1;
  }
  return { width, height, data: mask };
}

export async function loadPhotoFile(path: string, pixelsEdge = 160, uploadEdge = 1024): Promise<LoadedPhoto> {
  const image = await loadImage(path);
  const scale = Math.min(1, uploadEdge / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const jpeg = canvas.toBuffer('image/jpeg', { quality: 0.85 });
  const small = Math.min(1, pixelsEdge / Math.max(width, height));
  const pw = Math.max(1, Math.round(width * small));
  const ph = Math.max(1, Math.round(height * small));
  const smallCanvas = createCanvas(pw, ph);
  const smallContext = smallCanvas.getContext('2d');
  smallContext.drawImage(canvas, 0, 0, pw, ph);
  const { data } = smallContext.getImageData(0, 0, pw, ph);
  return { pixels: { width: pw, height: ph, data }, jpeg, width, height };
}
