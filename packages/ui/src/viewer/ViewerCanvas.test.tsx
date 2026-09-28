// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { viewerDprRange } from './ViewerCanvas';
import { configureViewerRenderer } from './createLupiRenderer';

describe('ViewerCanvas renderer policy', () => {
  it('bounds DPR by the detected device tier', () => {
    expect(viewerDprRange('mobile')).toEqual([1, 1.25]);
    expect(viewerDprRange('low')).toEqual([1, 1.25]);
    expect(viewerDprRange('desktop')).toEqual([1, 1.75]);
    expect(viewerDprRange('high')).toEqual([1, 1.75]);
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
