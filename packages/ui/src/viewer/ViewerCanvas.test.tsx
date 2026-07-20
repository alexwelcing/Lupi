// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  configureViewerRenderer,
  viewerDprRange,
  VIEWER_GL_OPTIONS,
} from './ViewerCanvas';

vi.mock('@react-three/xr', () => ({
  createXRStore: () => ({}),
  XR: () => null,
}));

describe('ViewerCanvas renderer policy', () => {
  it('keeps alpha enabled and bounds DPR by the detected device tier', () => {
    expect(VIEWER_GL_OPTIONS).toMatchObject({
      alpha: true,
      antialias: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    expect(viewerDprRange('mobile')).toEqual([1, 1.25]);
    expect(viewerDprRange('low')).toEqual([1, 1.25]);
    expect(viewerDprRange('desktop')).toEqual([1, 1.75]);
    expect(viewerDprRange('high')).toEqual([1, 1.75]);
  });

  it('uses sRGB output without a second renderer tone-map pass', () => {
    const renderer = {
      outputColorSpace: THREE.LinearSRGBColorSpace,
      shadowMap: { type: THREE.BasicShadowMap },
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 2,
    };

    configureViewerRenderer(renderer);

    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.toneMapping).toBe(THREE.NoToneMapping);
    expect(renderer.toneMappingExposure).toBe(1);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
  });
});
