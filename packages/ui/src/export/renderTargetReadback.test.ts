import { describe, expect, it } from 'vitest';
import { DataUtils } from 'three';
import type * as THREE from 'three/webgpu';
import { registerCaptureGuard } from '@atlas/scene';
import {
  captureSupersamplePlan,
  decodeHalfFloatReadback,
  halfToFloat,
  renderSceneToPixels,
  srgbOETF,
} from './renderTargetReadback';

const half = (value: number) => DataUtils.toHalfFloat(value);

/** RGBA16F rows as a readback returns them: `stride` bytes per row, last row unpadded. */
function readback(rows: number[][][], stride: number): Uint16Array {
  const width = rows[0].length;
  const bytes = stride * (rows.length - 1) + width * 8;
  const out = new Uint16Array(bytes / 2);
  rows.forEach((row, y) => {
    row.forEach((pixel, x) => {
      pixel.forEach((channel, c) => {
        out[(y * stride) / 2 + x * 4 + c] = half(channel);
      });
    });
  });
  return out;
}

const pixel = (rgba: Uint8ClampedArray, width: number, x: number, y: number) =>
  Array.from(rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));

describe('halfToFloat', () => {
  it('decodes normals, subnormals, zeros, infinities and NaN', () => {
    expect(halfToFloat(0x0000)).toBe(0);
    expect(Object.is(halfToFloat(0x8000), -0)).toBe(true);
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0x3800)).toBe(0.5);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x7bff)).toBe(65504);
    expect(halfToFloat(0x0001)).toBe(2 ** -24);
    expect(halfToFloat(0x03ff)).toBe(2 ** -14 * (1023 / 1024));
    expect(halfToFloat(0x7c00)).toBe(Infinity);
    expect(halfToFloat(0xfc00)).toBe(-Infinity);
    expect(halfToFloat(0x7e00)).toBeNaN();
  });

  it('round-trips three’s encoder', () => {
    for (const value of [0.108, 0.2158605, 0.5, 0.75, 1]) {
      expect(halfToFloat(half(value))).toBeCloseTo(value, 3);
    }
  });
});

describe('srgbOETF', () => {
  it('matches the sRGB transfer function and clamps', () => {
    expect(srgbOETF(0)).toBe(0);
    expect(srgbOETF(1)).toBeCloseTo(1, 12);
    expect(srgbOETF(0.0031308)).toBeCloseTo(0.04045, 5);
    expect(Math.round(srgbOETF(0.2158605) * 255)).toBe(128);
    expect(srgbOETF(-1)).toBe(0);
    expect(srgbOETF(2)).toBeCloseTo(1, 12);
    expect(srgbOETF(Number.NaN)).toBe(0);
  });
});

describe('decodeHalfFloatReadback', () => {
  it('de-strides WebGPU rows padded to 256 bytes (last row unpadded)', () => {
    const width = 3;
    const rows = [
      [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]],
      [[0.2158605, 0.2158605, 0.2158605, 1], [0, 0, 0, 0], [1, 1, 1, 1]],
    ];
    const data = readback(rows, 256);
    expect(data.byteLength).toBe(256 + width * 8);
    const rgba = decodeHalfFloatReadback(data, width, 2, false);
    expect(rgba.length).toBe(width * 2 * 4);
    expect(pixel(rgba, width, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(rgba, width, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(pixel(rgba, width, 2, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(rgba, width, 0, 1)).toEqual([128, 128, 128, 255]);
    expect(pixel(rgba, width, 1, 1)).toEqual([0, 0, 0, 0]);
    expect(pixel(rgba, width, 2, 1)).toEqual([255, 255, 255, 255]);
  });

  it('flips tight bottom-left WebGL2 rows to a top-left image', () => {
    const rows = [
      [[0, 0, 1, 1], [0, 0, 1, 1]], // bottom row in GL order
      [[1, 0, 0, 1], [1, 0, 0, 1]], // top row
    ];
    const data = readback(rows, 2 * 8);
    expect(data.byteLength).toBe(2 * 2 * 8);
    const rgba = decodeHalfFloatReadback(data, 2, 2, true);
    expect(pixel(rgba, 2, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(pixel(rgba, 2, 1, 1)).toEqual([0, 0, 255, 255]);
  });

  it('un-premultiplies in linear before the sRGB encode (half-alpha #ff8000)', () => {
    // Lead probe L3: half-alpha #ff8000 over clear 0 is stored as [0.5, 0.108, 0, 0.5].
    const data = readback([[[0.5, 0.108, 0, 0.5], [0, 0, 0, 0]]], 2 * 8);
    const rgba = decodeHalfFloatReadback(data, 2, 1, false);
    expect(pixel(rgba, 2, 0, 0)).toEqual([255, 128, 0, 128]);
    expect(pixel(rgba, 2, 1, 0)).toEqual([0, 0, 0, 0]);
  });

  it('accepts a view with a byte offset and rejects a short buffer', () => {
    const source = readback([[[1, 1, 1, 1]]], 8);
    const buffer = new Uint8Array(source.byteLength + 2);
    buffer.set(new Uint8Array(source.buffer), 2);
    const view = new Uint16Array(buffer.buffer, 2, source.length);
    expect(pixel(decodeHalfFloatReadback(view, 1, 1, false), 1, 0, 0)).toEqual([255, 255, 255, 255]);
    expect(() => decodeHalfFloatReadback(new Uint16Array(3), 1, 1, false)).toThrow(/needs 8/);
  });
});

describe('captureSupersamplePlan', () => {
  it('is 3× in one tile up to 1365 px and 2× above, never a tile over 4096 texels', () => {
    expect(captureSupersamplePlan(320, 200)).toEqual({ factor: 3, columns: 1, rows: 1, tileWidth: 320, tileHeight: 200 });
    expect(captureSupersamplePlan(1365, 1024)).toEqual({ factor: 3, columns: 1, rows: 1, tileWidth: 1365, tileHeight: 1024 });
    expect(captureSupersamplePlan(1366, 768)).toEqual({ factor: 2, columns: 1, rows: 1, tileWidth: 1366, tileHeight: 768 });
    expect(captureSupersamplePlan(2048, 2048)).toEqual({ factor: 2, columns: 1, rows: 1, tileWidth: 2048, tileHeight: 2048 });
    // The UI's PNG download: four equal 1080 px tiles (2160 texels each).
    expect(captureSupersamplePlan(2160, 2160)).toEqual({ factor: 2, columns: 2, rows: 2, tileWidth: 1080, tileHeight: 1080 });
    // Equal tiles; the last column runs one pixel past the image.
    expect(captureSupersamplePlan(2161, 100)).toEqual({ factor: 2, columns: 2, rows: 1, tileWidth: 1081, tileHeight: 100 });
    expect(captureSupersamplePlan(4096, 4096)).toEqual({ factor: 2, columns: 2, rows: 2, tileWidth: 2048, tileHeight: 2048 });
    for (const [w, h] of [[64, 64], [1365, 1365], [1366, 1366], [2049, 3000], [4096, 4096]]) {
      const plan = captureSupersamplePlan(w, h);
      expect(plan.tileWidth * plan.factor).toBeLessThanOrEqual(4096);
      expect(plan.tileHeight * plan.factor).toBeLessThanOrEqual(4096);
      expect(plan.tileWidth * plan.columns).toBeGreaterThanOrEqual(w);
      expect(plan.tileHeight * plan.rows).toBeGreaterThanOrEqual(h);
    }
  });

  it('keeps an untiled capture in one target of at most 4096 texels', () => {
    expect(captureSupersamplePlan(320, 200, false)).toEqual({ factor: 3, columns: 1, rows: 1, tileWidth: 320, tileHeight: 200 });
    expect(captureSupersamplePlan(2048, 1024, false)).toEqual({ factor: 2, columns: 1, rows: 1, tileWidth: 2048, tileHeight: 1024 });
    expect(captureSupersamplePlan(2160, 2160, false)).toEqual({ factor: 1, columns: 1, rows: 1, tileWidth: 2160, tileHeight: 2160 });
  });
});

describe('renderSceneToPixels capture guards', () => {
  it('holds guards around the render and restores them even when the render throws', async () => {
    const log: string[] = [];
    const off = registerCaptureGuard({ begin: () => (log.push('begin'), () => log.push('restore')) });
    const renderer = {
      backend: { isWebGPUBackend: true },
      autoClear: true, autoClearColor: true, autoClearDepth: true, autoClearStencil: true,
      getRenderTarget: () => null, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0, getMRT: () => null,
      getClearColor: (color: { set: (hex: number) => unknown }) => color.set(0),
      getClearAlpha: () => 1,
      setRenderTarget: () => log.push('setRenderTarget'), setMRT: () => {}, setClearColor: () => {},
      render: () => {
        log.push('render');
        throw new Error('render failed');
      },
    } as unknown as THREE.WebGPURenderer;
    try {
      await expect(renderSceneToPixels({
        renderer, scene: {} as THREE.Scene, camera: {} as THREE.Camera, width: 2, height: 2, transparent: true,
      })).rejects.toThrow('render failed');
    } finally {
      off();
    }
    expect(log).toEqual(['setRenderTarget', 'begin', 'render', 'restore', 'setRenderTarget']);
  });
});
