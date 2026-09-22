// Show what the masking step makes of each synthetic photo: the photo, then
// its mask cut at every contrast threshold, side by side, with the
// measurements Jev would be asked about.
//
//   pnpm scan:masks            → .verify-artifacts/masks-<kind>.png
import { writeFileSync } from 'node:fs';
import { createCanvas } from 'canvas';
import { cutMask, MASK_TOLERANCES, stageFromPhoto } from '../src/scan/gist/volumeStage';
import { SYNTHETIC_KINDS, syntheticPhoto } from './synthetic-photos.mts';

for (const kind of SYNTHETIC_KINDS) {
  const photo = syntheticPhoto(kind);
  const canvas = createCanvas(photo.width * (1 + MASK_TOLERANCES.length), photo.height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(photo.width, photo.height);
  image.data.set(photo.data);
  context.putImageData(image, 0, 0);
  const lines: string[] = [];
  MASK_TOLERANCES.forEach((tolerance, column) => {
    const candidate = cutMask(photo, tolerance);
    const panel = context.createImageData(photo.width, photo.height);
    for (let index = 0; index < candidate.mask.data.length; index += 1) {
      const on = candidate.mask.data[index] ? 255 : 20;
      panel.data[index * 4] = on;
      panel.data[index * 4 + 1] = on;
      panel.data[index * 4 + 2] = on;
      panel.data[index * 4 + 3] = 255;
    }
    context.putImageData(panel, photo.width * (column + 1), 0);
    const f = candidate.features;
    lines.push(`t${tolerance}: fill ${(f.fill * 100).toFixed(0)}% · aspect ${f.aspect.toFixed(2)} · pieces ${f.components} · symmetry ${f.symmetry.toFixed(2)} · edginess ${f.edginess.toFixed(2)} · profile ${f.profile.map((v) => v.toFixed(2)).join(' ')}`);
  });
  const stage = stageFromPhoto(photo);
  console.log(`${kind}: masked ${stage.masked} · ${stage.volume.filled} cells\n  ${lines.join('\n  ')}`);
  writeFileSync(new URL(`../../../.verify-artifacts/masks-${kind}.png`, import.meta.url), canvas.toBuffer('image/png'));
}
