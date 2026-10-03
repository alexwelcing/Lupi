import { describe, expect, it } from 'vitest';
import { inkSvgMarkup, type InkModel } from './ink';

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

const lines = (svg: string) => svg.match(/<line [^>]*\/>/g) ?? [];

describe('ink bond kinds', () => {
  it('draws coordination dashed and ionic contacts dotted, both thinner', () => {
    const svg = inkSvgMarkup({ ...MODEL, b: [0, 1, 0, 2, 0, 3], bk: [0, 1, 2] }, MODEL.opening, { idPrefix: 't' });
    const drawn = lines(svg);
    expect(drawn).toHaveLength(3);
    const dashed = drawn.filter((line) => line.includes('stroke-dasharray="4 3"'));
    const dotted = drawn.filter((line) => line.includes('stroke-dasharray="1 3"'));
    expect(dashed).toHaveLength(1);
    expect(dotted).toHaveLength(1);
    expect(drawn.filter((line) => !line.includes('stroke-dasharray'))).toHaveLength(1);
    const group = Number(/<g [^>]*stroke-width="([\d.]+)"/.exec(svg)![1]);
    const width = (line: string) => Number(/stroke-width="([\d.]+)"/.exec(line)![1]);
    expect(width(dashed[0])).toBeLessThan(group);
    expect(width(dotted[0])).toBeLessThan(width(dashed[0]));
  });

  it('leaves a model without bk exactly as before', () => {
    const plain = inkSvgMarkup(MODEL, MODEL.opening, { idPrefix: 't' });
    expect(plain).not.toContain('stroke-dasharray');
    expect(inkSvgMarkup({ ...MODEL, bk: [0, 0, 0] }, MODEL.opening, { idPrefix: 't' })).toBe(plain);
    expect(lines(plain).every((line) => !/stroke-width/.test(line))).toBe(true);
  });
});
