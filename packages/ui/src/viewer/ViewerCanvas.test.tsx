// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { budgetAtomCount, viewerDprRange } from './ViewerCanvas';
import { configureViewerRenderer } from './createLupiRenderer';

describe('ViewerCanvas renderer policy', () => {
  it('bounds DPR by the detected device tier and the structure size', () => {
    expect(viewerDprRange('mobile')).toEqual([1, 3]);
    expect(viewerDprRange('mobile', 49_999)).toEqual([1, 3]);
    expect(viewerDprRange('mobile', 50_000)).toEqual([1, 1.5]);
    expect(viewerDprRange('mobile', 400_001)).toEqual([1, 1.25]);
    expect(viewerDprRange('low', 60)).toEqual([1, 2]);
    expect(viewerDprRange('low', 50_000)).toEqual([1, 1.25]);
    expect(viewerDprRange('low', 1_000_000)).toEqual([1, 1.25]);
    expect(viewerDprRange('desktop', 60)).toEqual([1, 2]);
    expect(viewerDprRange('desktop', 400_000)).toEqual([1, 2]);
    expect(viewerDprRange('high', 2_000_000)).toEqual([1, 1.5]);
  });

  it('budgets a file by its largest resident frame', () => {
    expect(budgetAtomCount([])).toBe(0);
    expect(budgetAtomCount([undefined, { natoms: 12 }], { natoms: 5 })).toBe(12);
    expect(budgetAtomCount([{ natoms: 60_000 }, { natoms: 450_000 }])).toBe(450_000);
  });

  it('keeps a phone on the WebGL2 backend at most at DPR 2', () => {
    expect(viewerDprRange('mobile', 60, 'webgpu')).toEqual([1, 3]);
    expect(viewerDprRange('mobile', 60, 'webgl2')).toEqual([1, 2]);
    expect(viewerDprRange('mobile', 1_000_000, 'webgl2')).toEqual([1, 1.25]);
    expect(viewerDprRange('desktop', 60, 'webgl2')).toEqual([1, 2]);
  });

  it('uses sRGB output without a second renderer tone-map pass', () => {
    const renderer = {
      outputColorSpace: THREE.LinearSRGBColorSpace as string,
      shadowMap: { type: THREE.BasicShadowMap as THREE.ShadowMapType },
      toneMapping: THREE.ACESFilmicToneMapping as THREE.ToneMapping,
      toneMappingExposure: 2,
    };

    configureViewerRenderer(renderer);

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  });
});
