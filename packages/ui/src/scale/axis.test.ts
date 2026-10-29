// The slider's landmark labels: none prints over another, the deep end and
// the largest piece keep theirs, and the ends stay on the track.
import { describe, expect, it } from 'vitest';
import { placeTickLabels, sliderOfPhi, phiOfLambda, type TickPlacement } from './axis';
import { entryById } from './catalog';

const boxes = (labels: Array<{ pos: number; width: number }>, placed: TickPlacement[], track: number) =>
  labels
    .map((l, i) => ({ i, left: l.pos * track - l.width / 2 + placed[i].nudge, width: l.width, shown: placed[i].shown }))
    .filter((b) => b.shown);

describe('placeTickLabels', () => {
  it('prints every label when they all fit', () => {
    const labels = [{ pos: 0.1, width: 30 }, { pos: 0.5, width: 30 }, { pos: 0.9, width: 30 }];
    expect(placeTickLabels(labels, 400, 6).map((p) => p.shown)).toEqual([true, true, true]);
  });

  it('hides a crowded label and keeps the deepest and the largest', () => {
    // Four labels 12 px apart at the deep end, as the googolplex's 10^9, 10^6, 10^3 and 1 ion print at 1024 px.
    const labels = [{ pos: 0, width: 60 }, { pos: 0.5, width: 30 }, { pos: 0.94, width: 26 }, { pos: 0.96, width: 26 }, { pos: 0.98, width: 26 }, { pos: 1, width: 28 }];
    const placed = placeTickLabels(labels, 600, 6);
    expect(placed[0].shown).toBe(true);
    expect(placed[5].shown).toBe(true);
    expect(placed[1].shown).toBe(true);
    const shown = boxes(labels, placed, 600).sort((a, b) => a.left - b.left);
    for (let k = 1; k < shown.length; k += 1) {
      expect(shown[k].left).toBeGreaterThanOrEqual(shown[k - 1].left + shown[k - 1].width + 6);
    }
    expect(placed.filter((p) => !p.shown).length).toBeGreaterThan(0);
  });

  it('nudges the end labels inward to stay within the overhang', () => {
    const labels = [{ pos: 0, width: 60 }, { pos: 1, width: 40 }];
    const placed = placeTickLabels(labels, 300, 6, 9);
    expect(placed[0]).toEqual({ shown: true, nudge: 21 });
    expect(placed[1]).toEqual({ shown: true, nudge: -11 });
  });

  it('places nothing on a track with no width, and skips labels not measured yet', () => {
    expect(placeTickLabels([{ pos: 0.5, width: 20 }], 0, 6)).toEqual([{ shown: false, nudge: 0 }]);
    expect(placeTickLabels([{ pos: 0.5, width: 0 }, { pos: 1, width: 20 }], 200, 6).map((p) => p.shown)).toEqual([false, true]);
  });

  it('never prints two of the googolplex landmarks over each other, desktop to phone', () => {
    const entry = entryById('googolplex')!;
    const range = { phiMin: phiOfLambda(entry.landmarks[0].lambda) - 0.5, phiMax: phiOfLambda(entry.landmarks.at(-1)!.lambda) };
    const labels = entry.landmarks
      .map((l) => ({ pos: sliderOfPhi(phiOfLambda(l.lambda), range), width: 7 * l.label.length }))
      .filter((l) => l.pos >= 0 && l.pos <= 1);
    for (const track of [320, 358, 600, 930]) {
      const placed = placeTickLabels(labels, track, 6, 9);
      const shown = boxes(labels, placed, track).sort((a, b) => a.left - b.left);
      expect(shown.length).toBeGreaterThanOrEqual(2);
      for (let k = 1; k < shown.length; k += 1) {
        expect(shown[k].left).toBeGreaterThanOrEqual(shown[k - 1].left + shown[k - 1].width + 6 - 1e-9);
      }
      for (const b of shown) {
        expect(b.left).toBeGreaterThanOrEqual(-9);
        expect(b.left + b.width).toBeLessThanOrEqual(track + 9);
      }
    }
  });
});
