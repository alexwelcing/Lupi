// Write the synthetic photos as JPEGs, at a size a phone would send, for the
// remote-model benches (SAM 3, SAM 3D Objects) that need a real image file.
//
//   pnpm scan:photos:export     → .verify-artifacts/hf/photo-<kind>.jpg and mask-<kind>.png (the on-device flood mask, upscaled)
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas } from 'canvas';
import { cutMask, DEFAULT_TOLERANCE } from '../src/scan/gist/volumeStage';
import { SYNTHETIC_KINDS, syntheticPhoto } from './synthetic-photos.mts';
import { loadPhotoFile } from './photo-file.mts';

const out = fileURLToPath(new URL('../../../.verify-artifacts/hf/', import.meta.url));
mkdirSync(out, { recursive: true });
// `--import=<file> --as=<name>` brings a real photo in as photo-<name>.jpg (≤1024) with its device mask.
const importArg = process.argv.find((arg) => arg.startsWith('--import='))?.slice('--import='.length);
if (importArg) {
  const name = process.argv.find((arg) => arg.startsWith('--as='))?.slice('--as='.length) ?? 'file';
  const loaded = await loadPhotoFile(importArg);
  writeFileSync(`${out}photo-${name}.jpg`, loaded.jpeg);
  const cut = cutMask(loaded.pixels, DEFAULT_TOLERANCE);
  const maskCanvas = createCanvas(cut.mask.width, cut.mask.height);
  const maskContext = maskCanvas.getContext('2d');
  const mask = maskContext.createImageData(cut.mask.width, cut.mask.height);
  for (let index = 0; index < cut.mask.data.length; index += 1) {
    const on = cut.mask.data[index] ? 255 : 0;
    mask.data.set([on, on, on, 255], index * 4);
  }
  maskContext.putImageData(mask, 0, 0);
  writeFileSync(`${out}mask-${name}.png`, maskCanvas.toBuffer('image/png'));
  console.log(`imported ${importArg} as photo-${name}.jpg (${loaded.width}×${loaded.height}) · device cut fill ${(cut.features.fill * 100).toFixed(0)}% · ${cut.features.components} pieces`);
  process.exit(0);
}
for (const kind of SYNTHETIC_KINDS) {
  const photo = syntheticPhoto(kind, 640, 480);
  const canvas = createCanvas(photo.width, photo.height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(photo.width, photo.height);
  image.data.set(photo.data);
  context.putImageData(image, 0, 0);
  writeFileSync(`${out}photo-${kind}.jpg`, canvas.toBuffer('image/jpeg', { quality: 0.9 }));
  // The device's own mask at the size the page cuts it, scaled up to the photo, black and white.
  const small = syntheticPhoto(kind);
  const cut = cutMask(small, DEFAULT_TOLERANCE);
  const maskCanvas = createCanvas(photo.width, photo.height);
  const maskContext = maskCanvas.getContext('2d');
  const mask = maskContext.createImageData(photo.width, photo.height);
  for (let y = 0; y < photo.height; y += 1) {
    for (let x = 0; x < photo.width; x += 1) {
      const sx = Math.min(small.width - 1, Math.floor((x / photo.width) * small.width));
      const sy = Math.min(small.height - 1, Math.floor((y / photo.height) * small.height));
      const on = cut.mask.data[sy * small.width + sx] ? 255 : 0;
      const at = (y * photo.width + x) * 4;
      mask.data[at] = on;
      mask.data[at + 1] = on;
      mask.data[at + 2] = on;
      mask.data[at + 3] = 255;
    }
  }
  maskContext.putImageData(mask, 0, 0);
  writeFileSync(`${out}mask-${kind}.png`, maskCanvas.toBuffer('image/png'));
}
console.log(`wrote ${SYNTHETIC_KINDS.length} photos to ${out}`);
