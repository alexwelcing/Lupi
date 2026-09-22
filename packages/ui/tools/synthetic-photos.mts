// Synthetic "photos" for the headless tools: things a phone gets pointed at,
// drawn from arithmetic so the pipeline can be checked without a camera.
// Each is 160×120 RGBA with a little grain, a lit background that is not
// flat, and a subject that is not one colour, because the masking step has
// to cope with all three. Nothing here is a mask: the mask is cut from these
// exactly as it is cut from a real photo.
export type SyntheticKind = 'disc' | 'tree' | 'mug' | 'table' | 'tv' | 'cat';
export const SYNTHETIC_KINDS: SyntheticKind[] = ['disc', 'tree', 'mug', 'table', 'tv', 'cat'];
/** What a person would call each one; the subject label Jev is asked about. */
export const SYNTHETIC_SUBJECTS: Record<SyntheticKind, string> = { disc: 'red ball', tree: 'oak tree', mug: 'coffee mug', table: 'wooden table', tv: 'television', cat: 'cat' };

export interface SyntheticPhoto {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type Rgb = [number, number, number];

const grain = (x: number, y: number): number => {
  const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n) - 0.5) * 14;
};

export function syntheticPhoto(kind: SyntheticKind, width = 160, height = 120): SyntheticPhoto {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const u = x / width;
      const v = y / height;
      const rgb = paint(kind, x, y, u, v, width, height);
      const g = grain(x, y);
      const i = (y * width + x) * 4;
      data[i] = Math.max(0, Math.min(255, Math.round(rgb[0] + g)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(rgb[1] + g)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(rgb[2] + g)));
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

function paint(kind: SyntheticKind, x: number, y: number, u: number, v: number, width: number, height: number): Rgb {
  switch (kind) {
    case 'disc': {
      const dx = (u - 0.5) / 0.28;
      const dy = (v - 0.55) / 0.38;
      const inside = dx * dx + dy * dy < 1;
      const shade = inside ? 0.6 + 0.4 * (1 - Math.hypot(dx + 0.3, dy + 0.3) / 1.6) : 0.2 + 0.15 * v;
      return [(inside ? 220 : 70) * shade, (inside ? 70 : 90) * shade, (inside ? 50 : 120) * shade];
    }
    case 'tree': {
      const dx = (x - width * 0.5) / (width * 0.3);
      const dy = (y - height * 0.4) / (height * 0.32);
      const lump = Math.sin(x * 0.4) * 0.14 + Math.cos(y * 0.55) * 0.12;
      const crown = dx * dx + dy * dy < 1 + lump;
      const trunk = Math.abs(x - width * 0.5) < 5 && y > height * 0.55 && y < height * 0.92;
      const leaf = 0.55 + 0.45 * Math.abs(Math.sin(x * 1.3 + y * 0.7));
      return crown ? [40 * leaf, 120 * leaf + 30, 35 * leaf] : trunk ? [95, 62, 34] : [200 + 20 * v, 215, 235];
    }
    case 'mug': {
      // A dark red mug on a pale wooden desk, wall behind; the handle on the right has a real hole.
      const desk = v > 0.62;
      const wood = 0.9 + 0.1 * Math.sin(y * 1.7 + Math.sin(x * 0.2));
      const background: Rgb = desk ? [196 * wood, 164 * wood, 122 * wood] : [222 - 30 * v, 218 - 30 * v, 210 - 30 * v];
      const bodyLeft = 0.36;
      const bodyRight = 0.62;
      const top = 0.28;
      const bottom = 0.78;
      const corner = 0.03;
      const inBody = u > bodyLeft && u < bodyRight && v > top && v < bottom && !(v > bottom - corner && (u < bodyLeft + corner || u > bodyRight - corner));
      const hx = (u - 0.68) / 0.09;
      const hy = (v - 0.5) / 0.14;
      const ring = hx * hx + hy * hy;
      const inHandle = ring < 1 && ring > 0.36 && u > bodyRight - 0.01;
      if (inBody || inHandle) {
        const light = 0.55 + 0.45 * Math.max(0, 1 - Math.abs(u - 0.43) / 0.2);
        const rim = v < top + 0.03 ? 0.7 : 1;
        return [170 * light * rim, 40 * light * rim, 45 * light * rim];
      }
      return background;
    }
    case 'table': {
      // A wooden table seen from the front, on a grey floor against a cream wall.
      const floor = v > 0.7;
      const background: Rgb = floor ? [110 + 20 * v, 108 + 20 * v, 104 + 20 * v] : [236 - 20 * v, 230 - 20 * v, 218 - 20 * v];
      const topBand = v > 0.46 && v < 0.54 && u > 0.14 && u < 0.86;
      const apron = v >= 0.54 && v < 0.58 && u > 0.17 && u < 0.83;
      const frontLeg = (Math.abs(u - 0.2) < 0.018 || Math.abs(u - 0.8) < 0.018) && v >= 0.58 && v < 0.9;
      const backLeg = (Math.abs(u - 0.31) < 0.012 || Math.abs(u - 0.69) < 0.012) && v >= 0.58 && v < 0.84;
      if (topBand || apron || frontLeg || backLeg) {
        const grainLine = 0.85 + 0.15 * Math.sin(x * 0.9 + y * 0.3);
        const shade = topBand ? 1 : apron ? 0.8 : frontLeg ? 0.7 : 0.55;
        return [150 * grainLine * shade, 96 * grainLine * shade, 52 * grainLine * shade];
      }
      return background;
    }
    case 'tv': {
      // A flat television on a low cabinet: black bezel, a bright picture, a thin stand.
      const cabinet = v > 0.82;
      const background: Rgb = cabinet ? [62, 48, 36] : [214 - 24 * v, 210 - 24 * v, 204 - 24 * v];
      const left = 0.12;
      const right = 0.88;
      const top = 0.12;
      const bottom = 0.7;
      const bezel = 0.018;
      const inSet = u > left && u < right && v > top && v < bottom;
      const inScreen = u > left + bezel && u < right - bezel && v > top + bezel && v < bottom - bezel;
      const stand = (Math.abs(u - 0.5) < 0.02 && v >= bottom && v < 0.78) || (Math.abs(u - 0.5) < 0.12 && v >= 0.78 && v < 0.82);
      if (inScreen) {
        // A sky over hills, a picture with its own colours and edges.
        const sy = (v - top) / (bottom - top);
        const hill = sy > 0.62 + 0.08 * Math.sin(u * 9);
        return hill ? [40, 90 + 30 * sy, 50] : [70 + 90 * sy, 130 + 80 * sy, 220];
      }
      if (inSet || stand) return [18, 18, 20];
      return background;
    }
    case 'cat': {
      // A ginger cat sitting up, seen from the side, on a grey sofa cushion.
      const cushion = v > 0.75;
      const weave = 0.95 + 0.05 * Math.sin(x * 2.1) * Math.sin(y * 2.3);
      const background: Rgb = cushion ? [128 * weave, 124 * weave, 130 * weave] : [176 - 20 * v, 170 - 20 * v, 180 - 20 * v];
      const bx = (u - 0.5) / 0.2;
      const by = (v - 0.58) / 0.22;
      const body = bx * bx + by * by < 1;
      const chest = ((u - 0.56) / 0.1) ** 2 + ((v - 0.5) / 0.2) ** 2 < 1;
      const hx = (u - 0.6) / 0.11;
      const hy = (v - 0.3) / 0.13;
      const head = hx * hx + hy * hy < 1;
      const earL = v < 0.24 && v > 0.14 && Math.abs(u - 0.55) < (v - 0.14) * 0.6;
      const earR = v < 0.24 && v > 0.14 && Math.abs(u - 0.66) < (v - 0.14) * 0.6;
      const tailAngle = Math.atan2(v - 0.7, u - 0.25);
      const tailRadius = Math.hypot((u - 0.25) / 1.0, (v - 0.7) / 0.8);
      const tail = tailRadius > 0.1 && tailRadius < 0.14 && tailAngle > -2.9 && tailAngle < 0.2;
      const paws = v > 0.72 && v < 0.79 && u > 0.4 && u < 0.66;
      if (body || chest || head || earL || earR || tail || paws) {
        const stripe = 0.72 + 0.28 * Math.abs(Math.sin(y * 0.9 + x * 0.25));
        const belly = chest && !head ? 1.15 : 1;
        return [222 * stripe * Math.min(1, belly), 132 * stripe * belly, 62 * stripe];
      }
      return background;
    }
  }
}
