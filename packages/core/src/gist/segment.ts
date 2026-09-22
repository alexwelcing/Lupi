/**
 * The object, cut from its photo, with no model and no vocabulary.
 *
 * A phone photo of a thing has at least two backgrounds: the wall behind it
 * and the surface it stands on, each with its own gradient, shadow, and
 * texture. One "background colour" cannot describe that, so the cut is a
 * flood instead: starting from the border, the background grows into every
 * neighbouring pixel whose colour is close to the pixel it came from. A
 * gradient is a chain of small steps, so it floods; a shadow floods; the
 * desk floods from the bottom edge and the wall from the top; the object's
 * edge is the one step too big to take. What the flood cannot reach is the
 * object.
 *
 * Two refinements keep that honest. The flood is seeded only from border
 * pixels that look like their own side of the border, so a table's legs or
 * a cat's tail touching the bottom edge do not seed the flood inside the
 * object. And an enclosed region the flood could not reach, but which wears
 * colours the flooded background is made of (the wall seen through a mug's
 * handle), is punched back out.
 *
 * Everything works on a small copy of the photo (160 px on the long edge)
 * after a 3×3 median, so grain is not an edge, and runs in a few milliseconds.
 */
import type { MaskImage } from './volume';

export interface RgbImage {
  width: number;
  height: number;
  /** RGBA, row-major. */
  data: Uint8ClampedArray | Uint8Array;
}

/** Sum-of-channels colour distance between two pixels of an RGB float image. */
function l1(a: Float32Array, i: number, j: number): number {
  return Math.abs(a[i] - a[j]) + Math.abs(a[i + 1] - a[j + 1]) + Math.abs(a[i + 2] - a[j + 2]);
}

/**
 * A 3×3 median of each RGB channel, as floats. Grain goes; edges stay sharp,
 * which matters twice: a blur would put in-between colours along every edge,
 * letting the flood climb a sharp tip in small steps, and would paint a
 * seam where two backgrounds meet that belongs to neither.
 */
export function smoothRgb(image: RgbImage): Float32Array {
  const { width, height, data } = image;
  const out = new Float32Array(width * height * 3);
  const window = new Float32Array(9);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 1);
    const y1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - 1);
      const x1 = Math.min(width - 1, x + 1);
      const o = (y * width + x) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        let n = 0;
        for (let yy = y0; yy <= y1; yy += 1) for (let xx = x0; xx <= x1; xx += 1) window[n++] = data[(yy * width + xx) * 4 + channel];
        // Insertion sort of at most nine values; the median is the middle one.
        for (let i = 1; i < n; i += 1) {
          const value = window[i];
          let j = i - 1;
          while (j >= 0 && window[j] > value) {
            window[j + 1] = window[j];
            j -= 1;
          }
          window[j + 1] = value;
        }
        out[o + channel] = window[n >> 1];
      }
    }
  }
  return out;
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

/**
 * Flood the background in from the border and return the object mask:
 * 1 where the flood did not reach. `tolerance` is the largest colour step
 * (sum of channel differences, 0..765) the flood may take between
 * neighbours; 20 is strict, 40 crosses most texture.
 */
export function floodMask(image: RgbImage, tolerance: number, smoothed: Float32Array = smoothRgb(image)): MaskImage {
  const { width, height } = image;
  const size = width * height;
  const background = new Uint8Array(size);
  if (width < 4 || height < 4) return { width, height, data: new Uint8Array(size).fill(1) };
  const stack: number[] = [];

  // Seeds: border pixels that look like their own side of the border.
  const sides: Array<{ pixels: number[] }> = [{ pixels: [] }, { pixels: [] }, { pixels: [] }, { pixels: [] }];
  for (let x = 0; x < width; x += 1) {
    sides[0].pixels.push(x);
    sides[1].pixels.push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    sides[2].pixels.push(y * width);
    sides[3].pixels.push(y * width + width - 1);
  }
  for (const side of sides) {
    const r = median(side.pixels.map((index) => smoothed[index * 3]));
    const g = median(side.pixels.map((index) => smoothed[index * 3 + 1]));
    const b = median(side.pixels.map((index) => smoothed[index * 3 + 2]));
    for (const index of side.pixels) {
      const at = index * 3;
      const distance = Math.abs(smoothed[at] - r) + Math.abs(smoothed[at + 1] - g) + Math.abs(smoothed[at + 2] - b);
      // A side may carry a gradient along it, so the seed test is loose; the flood itself is strict.
      if (distance <= tolerance * 3 && !background[index]) {
        background[index] = 1;
        stack.push(index);
      }
    }
  }
  if (stack.length === 0) {
    // No side agrees with itself: flood from every border pixel and hope.
    for (const side of sides) for (const index of side.pixels) if (!background[index]) {
      background[index] = 1;
      stack.push(index);
    }
  }

  while (stack.length) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    const here = index * 3;
    const visit = (next: number) => {
      if (background[next]) return;
      if (l1(smoothed, here, next * 3) > tolerance) return;
      background[next] = 1;
      stack.push(next);
    };
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }

  // Holes: unreached regions wearing the background's own colours.
  const bins = new Map<number, number>();
  const bin = (at: number): number => ((smoothed[at] >> 4) << 8) | ((smoothed[at + 1] >> 4) << 4) | (smoothed[at + 2] >> 4);
  let flooded = 0;
  for (let index = 0; index < size; index += 1) {
    if (!background[index]) continue;
    flooded += 1;
    const key = bin(index * 3);
    bins.set(key, (bins.get(key) ?? 0) + 1);
  }
  const populated = Math.max(24, flooded * 0.004);
  const wearsBackground = (index: number): boolean => {
    const at = index * 3;
    const r = smoothed[at] >> 4;
    const g = smoothed[at + 1] >> 4;
    const b = smoothed[at + 2] >> 4;
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dg = -1; dg <= 1; dg += 1) {
        for (let db = -1; db <= 1; db += 1) {
          const rr = r + dr;
          const gg = g + dg;
          const bb = b + db;
          if (rr < 0 || gg < 0 || bb < 0 || rr > 15 || gg > 15 || bb > 15) continue;
          if ((bins.get((rr << 8) | (gg << 4) | bb) ?? 0) >= populated) return true;
        }
      }
    }
    return false;
  };
  const data = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) data[index] = background[index] || wearsBackground(index) ? 0 : 1;
  return { width, height, data };
}
