import { describe, expect, it } from 'vitest';
import {
  CLIP_FPS,
  clipFrameCount,
  clipFrameDuration,
  clipFrameTime,
  clipFrameTimestamp,
  flashAt,
  tapeFlashes,
} from './clipSchedule';
import type { TapeEvent } from './tape';

describe('the clip frame schedule', () => {
  it('has one frame per 1/30 s of the clip, at least one', () => {
    expect(CLIP_FPS).toBe(30);
    // A 4 s flick plus the 0.9 s end card.
    expect(clipFrameCount(4 + 0.9)).toBe(147);
    // The 8 s cap plus the end card.
    expect(clipFrameCount(8.9)).toBe(267);
    expect(clipFrameCount(1 / 30)).toBe(1);
    expect(clipFrameCount(0)).toBe(1);
    expect(clipFrameCount(Number.NaN)).toBe(1);
  });

  it('puts frame i at i / 30 s with an integer timestamp in µs', () => {
    expect(clipFrameTime(0)).toBe(0);
    expect(clipFrameTime(45)).toBeCloseTo(1.5, 12);
    expect(clipFrameTimestamp(0)).toBe(0);
    expect(clipFrameTimestamp(1)).toBe(33_333);
    expect(clipFrameTimestamp(2)).toBe(66_667);
    expect(clipFrameTimestamp(30)).toBe(1_000_000);
    for (let i = 0; i < 300; i += 1) {
      expect(Number.isInteger(clipFrameTimestamp(i))).toBe(true);
      expect(clipFrameTimestamp(i + 1)).toBeGreaterThan(clipFrameTimestamp(i));
    }
  });

  it('gives frame durations that add up to the clip exactly', () => {
    const frames = clipFrameCount(4.9);
    let sum = 0;
    for (let i = 0; i < frames; i += 1) {
      const duration = clipFrameDuration(i);
      expect(duration === 33_333 || duration === 33_334).toBe(true);
      sum += duration;
    }
    expect(sum).toBe(clipFrameTimestamp(frames));
    expect(sum).toBe(4_900_000);
  });
});

describe('flashes on the clip clock', () => {
  const events: TapeEvent[] = [
    { t: 0.2, kind: 'poke', atom: 3 },
    { t: 0.5, kind: 'label', flash: 'catch', text: 'Caught' },
    { t: 0.9, kind: 'label', flash: 'info', text: 'Toys rest with Refractive glass' },
    { t: 2.0, kind: 'label', flash: 'detent', text: 'Pentagon face-on · 5-fold axis' },
    { t: 2.6, kind: 'label', flash: 'flip', text: 'Flip!' },
  ];
  const flashes = tapeFlashes({ events });

  it('reads the labels from the tape, for as long as the pill shows them, without the pill talking', () => {
    expect(flashes.map((flash) => [flash.text, flash.from, Math.round(flash.until * 1000) / 1000])).toEqual([
      ['Caught', 0.5, 1.2],
      ['Pentagon face-on · 5-fold axis', 2.0, 3.2],
      ['Flip!', 2.6, 4.4],
    ]);
  });

  it('shows the latest flash that has started and not ended; a new one replaces the last', () => {
    expect(flashAt(flashes, 0.4)).toBeNull();
    expect(flashAt(flashes, 0.5)?.text).toBe('Caught');
    expect(flashAt(flashes, 1.19)?.text).toBe('Caught');
    expect(flashAt(flashes, 1.2)).toBeNull();
    expect(flashAt(flashes, 2.3)?.text).toBe('Pentagon face-on · 5-fold axis');
    expect(flashAt(flashes, 2.6)?.text).toBe('Flip!');
    expect(flashAt(flashes, 3.0)?.text).toBe('Flip!');
    expect(flashAt(flashes, 4.4)).toBeNull();
    expect(flashAt([], 1)).toBeNull();
  });

  it('lands on frame boundaries: a flash at 2.0 s is on frame 60 and not frame 59', () => {
    expect(flashAt(flashes, clipFrameTime(59))?.text).toBeUndefined();
    expect(flashAt(flashes, clipFrameTime(60))?.text).toBe('Pentagon face-on · 5-fold axis');
  });
});
