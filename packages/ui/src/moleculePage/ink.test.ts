import { describe, expect, it } from 'vitest';
import { INK_LOOK_COLORS, INK_LOOK_TUNING } from '@atlas/scene';
import {
  INK_CAP_FULL,
  INK_DRAWING_STYLE,
  INK_TOON,
  InkLayout,
  InkToonPalette,
  inkBandSpans,
  inkCapPath,
  inkSvgMarkup,
  inkToonFills,
  inkToonShapes,
  type InkModel,
  type InkShape,
} from './ink';

// A water-like triangle plus a sodium ion: one covalent pair, one dashed, one dotted.
const MODEL: InkModel = {
  p: [0, 0, 0, 0.96, 0, 0, -0.24, 0.93, 0, 2.4, 0, 0],
  k: [0, 1, 1, 2],
  kinds: [
    { s: 'O', c: '#ff0d0d', r: 0.5 },
    { s: 'H', c: '#ffffff', r: 0.3 },
    { s: 'Na', c: '#ab5cf2', r: 0.7 },
  ],
  b: [0, 1, 0, 2, 0, 3],
  radius: 3,
  detents: [],
  opening: { azimuth: 0.4, elevation: 0.2 },
};

/** A C60-sized cage: 60 carbons on a 3.55 Å sphere, each bonded to its three nearest. */
function cage(): InkModel {
  const p: number[] = [];
  const count = 60;
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const ring = Math.sqrt(1 - y * y);
    const turn = i * Math.PI * (3 - Math.sqrt(5));
    p.push(3.55 * ring * Math.cos(turn), 3.55 * y, 3.55 * ring * Math.sin(turn));
  }
  const pairs = new Set<string>();
  for (let i = 0; i < count; i += 1) {
    const near = Array.from({ length: count }, (_, j) => j)
      .filter((j) => j !== i)
      .sort((a, b) => Math.hypot(p[3 * a] - p[3 * i], p[3 * a + 1] - p[3 * i + 1], p[3 * a + 2] - p[3 * i + 2])
        - Math.hypot(p[3 * b] - p[3 * i], p[3 * b + 1] - p[3 * i + 1], p[3 * b + 2] - p[3 * i + 2]))
      .slice(0, 3);
    for (const j of near) pairs.add(i < j ? `${i},${j}` : `${j},${i}`);
  }
  return {
    p,
    k: new Array(count).fill(0),
    kinds: [{ s: 'C', c: '#909090', r: 0.342 }],
    b: [...pairs].flatMap((pair) => pair.split(',').map(Number)),
    radius: 3.9,
    detents: [],
    opening: { azimuth: 0.29, elevation: 0.31 },
  };
}

/** The toon shapes of every item, back to front. */
function shapesOf(model: InkModel, perspective: number | null = null): { layout: InkLayout; items: InkShape[][] } {
  const layout = new InkLayout(model);
  layout.setPerspective(perspective);
  layout.update(model.opening);
  const palette = new InkToonPalette(model);
  const items: InkShape[][] = [];
  for (let item = 0; item < layout.itemCount; item += 1) {
    const out: InkShape[] = [];
    inkToonShapes(layout, palette, item, out);
    items.push(out);
  }
  return { layout, items };
}

const lines = (shapes: InkShape[]) => shapes.filter((shape): shape is Extract<InkShape, { tag: 'line' }> => shape.tag === 'line');

describe('ink drawing style', () => {
  it('is the toon drawing (the lit balls are one constant away)', () => {
    expect(INK_DRAWING_STYLE).toBe('toon');
    const svg = inkSvgMarkup(MODEL, MODEL.opening, { idPrefix: 't' });
    expect(svg).not.toContain('radialGradient');
    expect(svg).not.toContain('<defs>');
  });

  it('follows the Illustrate look: the same bands, fills, lines, depth cue and palette', () => {
    for (const key of [
      'shadeBand', 'lightBand', 'highlight', 'flatLift', 'flatShade', 'lightLift', 'highlightLift', 'occlusionGain',
      'atomLine', 'bondLine', 'bondSolidFrom', 'bondSolidTo', 'depthCue', 'depthCueFrom',
    ] as const) {
      expect(INK_TOON[key], key).toBe(INK_LOOK_TUNING[key]);
    }
    expect(INK_TOON.ink).toBe(INK_LOOK_COLORS.ink);
    expect(INK_TOON.paper).toBe(INK_LOOK_COLORS.paper);
    expect(INK_TOON.shade).toBe(INK_LOOK_COLORS.shade);
  });

  it('mixes the fills in linear light: colour lifted toward paper, shade darker, lit and catchlight lighter', () => {
    const fills = inkToonFills('#909090');
    const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(luma(fills.shade)).toBeLessThan(luma(fills.color));
    expect(luma(fills.color)).toBeLessThan(luma(fills.light));
    expect(luma(fills.light)).toBeLessThan(luma(fills.highlight));
    // CPK carbon (#909090 → 0.279 linear) 8 % of the way to paper.
    expect(fills.color[0]).toBeCloseTo(0.279 + (0.896 - 0.279) * 0.08, 2);
  });
});

describe('ink toon geometry', () => {
  it('lights the whole face, none of it, or an ellipse when the band edge stays in front', () => {
    expect(inkCapPath(50, 50, 10, [0, 0, 1], -1)).toBe(INK_CAP_FULL);
    expect(inkCapPath(50, 50, 10, [0, 0, 1], -0.2)).toBe(INK_CAP_FULL);
    expect(inkCapPath(50, 50, 10, [0, 0, -1], 0.2)).toBe('');
    // A light toward the camera: the lit band is an ellipse about its screen direction.
    const ellipse = inkCapPath(50, 50, 10, [0.2, 0, Math.sqrt(1 - 0.04)], 0.6);
    expect(ellipse.match(/A/g)).toHaveLength(2);
    expect(ellipse.match(/M/g)).toHaveLength(1);
    // A light behind the ball: the band rings a dark ellipse (a hole: two loops).
    const ring = inkCapPath(50, 50, 10, [0.2, 0, -Math.sqrt(1 - 0.04)], -0.6);
    expect(ring.match(/M/g)).toHaveLength(2);
  });

  it('bounds a band that crosses the silhouette by two rim points, mirrored about the light', () => {
    const d = inkCapPath(50, 50, 10, [0.6, 0.48, 0.64], 0.48);
    const numbers = d.match(/-?[\d.]+/g)!.map(Number);
    const [ax, ay] = numbers.slice(0, 2);
    const [bx, by] = numbers.slice(7, 9);
    expect(Math.hypot(ax - 50, ay - 50)).toBeCloseTo(10, 0);
    expect(Math.hypot(bx - 50, by - 50)).toBeCloseTo(10, 0);
    // The light points right and up on screen (SVG y down): the chord is square to (0.6, −0.48).
    expect((bx - ax) * 0.6 + (by - ay) * -0.48).toBeCloseTo(0, 0);
  });

  it('spans the stick across the lit side', () => {
    expect(inkBandSpans(1, 0, 0)).toEqual([[-1, 1]]);
    const [[from, to]] = inkBandSpans(0, 1, 0.5);
    expect(from).toBeCloseTo(0.5, 6);
    expect(to).toBeCloseTo(1, 6);
    // From behind, both edges.
    const rim = inkBandSpans(-1, 0, -0.5);
    expect(rim).toHaveLength(2);
    expect(rim[0][0]).toBeCloseTo(-1, 6);
    expect(rim[0][1]).toBeCloseTo(-Math.sin(Math.PI / 3), 6);
    expect(rim[1][0]).toBeCloseTo(Math.sin(Math.PI / 3), 6);
  });

  it('outlines every ball in ink and fades the back toward the plate', () => {
    const { layout, items } = shapesOf(cage());
    const discs = items.slice(0, layout.atomCount).map((shapes) => shapes[0]);
    expect(discs.every((disc) => disc.tag === 'circle' && disc.stroke !== undefined)).toBe(true);
    const front = layout.vz.indexOf(Math.max(...layout.vz));
    const back = layout.vz.indexOf(Math.min(...layout.vz));
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16);
    const frontDisc = discs[front] as Extract<InkShape, { tag: 'circle' }>;
    const backDisc = discs[back] as Extract<InkShape, { tag: 'circle' }>;
    expect(lum(backDisc.fill)).toBeLessThan(lum(frontDisc.fill) + 1);
  });

  it('draws each stick as ink edges under its fills, a colour per half when the atoms differ', () => {
    const { layout, items } = shapesOf({ ...MODEL, b: [0, 1], bk: undefined, radius: 1.5 });
    const stick = lines(items[layout.atomCount]);
    // The ink, a shade toward the plate where the depth cue reaches it.
    const ink = [1, 3, 5].map((at) => parseInt(stick[0].stroke.slice(at, at + 2), 16));
    expect(Math.max(...ink.map((channel, k) => Math.abs(channel - [0x0c, 0x12, 0x11][k])))).toBeLessThanOrEqual(4);
    const fills = stick.slice(1);
    expect(fills.length).toBeGreaterThan(1);
    expect(fills.every((line) => line.width < stick[0].width)).toBe(true);
    // O–H: the O half and the H half differ.
    expect(new Set(fills.map((line) => line.stroke)).size).toBeGreaterThan(1);
  });

  it('puts the drawing in the viewer\'s perspective: near atoms larger, far ones smaller', () => {
    const model = cage();
    const flat = shapesOf(model).layout;
    const deep = shapesOf(model, 12).layout;
    const front = deep.vz.indexOf(Math.max(...deep.vz));
    const back = deep.vz.indexOf(Math.min(...deep.vz));
    expect(deep.r[front] / deep.r[back]).toBeGreaterThan(1.6);
    expect(flat.r[front] / flat.r[back]).toBeLessThan(1.2);
    expect(deep.k[front]).toBeGreaterThan(1);
  });
});

describe('ink bond kinds', () => {
  it('draws coordination dashed and ionic contacts dotted, both thinner', () => {
    const { layout, items } = shapesOf({ ...MODEL, b: [0, 1, 0, 2, 0, 3], bk: [0, 1, 2] });
    const bonds = items.slice(layout.atomCount).map(lines);
    expect(bonds[0].every((line) => !line.dash)).toBe(true);
    expect(bonds[1].length).toBeGreaterThan(0);
    expect(bonds[1].every((line) => line.dash === '4 3')).toBe(true);
    expect(bonds[2].every((line) => line.dash === '1 3')).toBe(true);
    const ink = (shapes: ReturnType<typeof lines>) => shapes[0].width;
    expect(ink(bonds[1])).toBeLessThan(ink(bonds[0]));
    expect(ink(bonds[2])).toBeLessThan(ink(bonds[1]));
  });

  it('leaves a model without bk exactly as before', () => {
    const plain = inkSvgMarkup(MODEL, MODEL.opening, { idPrefix: 't' });
    expect(plain).not.toContain('stroke-dasharray');
    expect(inkSvgMarkup({ ...MODEL, bk: [0, 0, 0] }, MODEL.opening, { idPrefix: 't' })).toBe(plain);
  });
});

describe('ink markup', () => {
  it('is deterministic', () => {
    const model = cage();
    expect(inkSvgMarkup(model, model.opening, { idPrefix: 'a' })).toBe(inkSvgMarkup(model, model.opening, { idPrefix: 'a' }));
  });

  it('stays small: a C60-sized drawing under 60 kB, about 0.6 kB an atom with its bonds', () => {
    const model = cage();
    const svg = inkSvgMarkup(model, model.opening, { idPrefix: 'a', attrs: { width: '400', height: '400' } });
    expect(svg.length).toBeLessThan(60_000);
    expect(svg.length / (model.k.length + model.b.length / 2)).toBeLessThan(400);
  });
});
