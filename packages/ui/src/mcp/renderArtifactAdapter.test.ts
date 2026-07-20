import { describe, expect, it } from 'vitest';
import type { Frame, Trajectory } from '@atlas/core';
import { useStore, type LoadedFile } from '../store';
import {
  browserRendererRuntimeV1,
  canonicalArtifactCameraPlanesV1,
  createBrowserRenderArtifactPlanV1,
  createInlineBrowserDeliveryV1,
  resolveBrowserBuildIdentityV1,
} from './renderArtifactAdapter';

const TEST_BUILD_SHA = '0123456789abcdef0123456789abcdef01234567';
const NEXT_BUILD_SHA = '89abcdef0123456789abcdef0123456789abcdef';

function loadedFile(name = 'same.xyz', position = 1): LoadedFile {
  const frame: Frame = {
    timestep: 0,
    natoms: 2,
    boxBounds: new Float64Array([0, 10, 0, 10, 0, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2]),
    types: new Int32Array([6, 8]),
    positions: new Float32Array([0, 0, 0, position, 2, 3]),
    bonds: new Int32Array([0, 1]),
    properties: new Map(),
  };
  const trajectory: Trajectory = {
    frames: [frame],
    totalFrames: 1,
    atomTypes: [6, 8],
    globalBounds: { min: [0, 0, 0], max: [10, 10, 10] },
  };
  return { name, size: 123, trajectory, thermo: null, sourceUrl: `https://example.invalid/${name}` };
}

async function plan(overrides: Record<string, unknown> = {}) {
  useStore.getState().reset();
  useStore.getState().setFile(loadedFile());
  useStore.setState({
    playing: false,
    showBonds: false,
    showKnowledgeLabels: false,
    annotations: [],
    ghostFile: null,
    ...overrides,
  });
  return createBrowserRenderArtifactPlanV1(useStore.getState(), {
    format: 'png',
    width: 320,
    height: 240,
    transparent: false,
    delivery: createInlineBrowserDeliveryV1(1_000_000, 'asset.png'),
    buildSha: TEST_BUILD_SHA,
  });
}

describe('browser render artifact adapter', () => {
  it('finalizes a content-addressed spec and keeps delivery outside identity', async () => {
    const first = await plan();
    const second = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png',
      width: 320,
      height: 240,
      transparent: false,
      delivery: createInlineBrowserDeliveryV1(2_000_000, 'another.png'),
      buildSha: TEST_BUILD_SHA,
    });

    expect(first.spec.source.kind).toBe('content');
    expect(first.specId).toBe(second.specId);
    expect(first.artifactKey).toBe(second.artifactKey);
    expect(first.request.delivery).not.toEqual(second.request.delivery);
  });

  it('changes identity for decoded content and visible appearance', async () => {
    const original = await plan();
    useStore.getState().setFile(loadedFile('same.xyz', 9));
    useStore.setState({ showBonds: false });
    const contentChanged = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(contentChanged.specId).not.toBe(original.specId);

    useStore.setState({ surfaceClearcoat: 0.9 });
    const appearanceChanged = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(appearanceChanged.specId).not.toBe(contentChanged.specId);
  });

  it('addresses the active raster property range', async () => {
    const baseline = await plan({ propRange: [0, 1] });
    useStore.setState({ propRange: [-2, 4] });
    const changed = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });

    expect(baseline.spec.view.atoms).toMatchObject({ propertyRange: [0, 1] });
    expect(changed.spec.view.atoms).toMatchObject({ propertyRange: [-2, 4] });
    expect(changed.specId).not.toBe(baseline.specId);
  });

  it('addresses the raster axes gizmo and excludes it from model geometry', async () => {
    const withAxes = await plan({ showAxes: true });
    expect(withAxes.spec.layers.axes).toBe(true);
    expect(withAxes.spec.view.axes).toMatchObject({ kind: 'canvas-overlay-v1' });

    useStore.setState({ showAxes: false });
    const withoutAxes = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(withoutAxes.spec.layers.axes).toBe(false);
    expect(withoutAxes.specId).not.toBe(withAxes.specId);

    useStore.setState({ showAxes: true });
    const model = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'glb',
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(model.spec.layers.axes).toBe(false);
  });

  it('omits background state for transparent output and rejects unsupported live state', async () => {
    const transparent = await createBrowserRenderArtifactPlanV1((await plan()).request
      ? useStore.getState()
      : useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: true,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(transparent.spec.layers.background).toBe(false);
    expect(transparent.spec.view).not.toHaveProperty('background');

    useStore.setState({ playing: true });
    await expect(createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    })).rejects.toThrow(/Pause trajectory playback/);
  });

  it('rejects model transparency and fails closed for nondeterministic USDZ artifact bytes', async () => {
    await plan();
    await expect(createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'glb', transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    })).rejects.toThrow(/does not accept the raster transparent field/);
    await expect(createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'usdz',
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    })).rejects.toThrow(/usdz is unsupported by this renderer/i);
  });

  it('addresses deterministic projection planes derived from source bounds', async () => {
    const result = await plan();
    expect(result.spec.view.camera).toMatchObject({
      near: expect.any(Number),
      far: 10_000,
    });
    const camera = result.spec.view.camera as Record<string, unknown>;
    expect(camera.near).toBeCloseTo(Math.hypot(10, 10, 10) * 1.4 * 0.002);

    const file = loadedFile();
    expect(canonicalArtifactCameraPlanesV1({
      file,
      cameraPosition: [5, 5, 25],
    })).toEqual({
      near: Math.hypot(10, 10, 10) * 1.4 * 0.002,
      far: 10_000,
    });
  });

  it('uses an origin-free module id and probes the descendant R3F canvas', () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'lupi-viewer-canvas';
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getContext', { value: () => null });
    wrapper.append(canvas);
    document.body.append(wrapper);
    try {
      const runtime = browserRendererRuntimeV1();
      expect(runtime).toMatchObject({
        moduleId: '@atlas/ui/mcp/renderArtifactAdapter',
        webgl: { status: 'webgl2-unavailable' },
      });
      expect(runtime).not.toHaveProperty('moduleUrl');
    } finally {
      wrapper.remove();
    }
  });
});

describe('browser renderer build identity', () => {
  it('requires an exact SHA for durable production identity', () => {
    expect(resolveBrowserBuildIdentityV1({
      production: true,
      injectedSha: TEST_BUILD_SHA.toUpperCase(),
    })).toEqual({
      buildId: TEST_BUILD_SHA,
      gitSha: TEST_BUILD_SHA,
      durability: 'durable-release',
      source: 'vite-production-sha',
    });

    expect(() => resolveBrowserBuildIdentityV1({ production: true })).toThrow(
      /requires VITE_LUPI_BUILD_SHA.*40-hex Git SHA/i,
    );
    expect(() => resolveBrowserBuildIdentityV1({
      production: true,
      injectedSha: 'main',
    })).toThrow(/exact 40-hex Git SHA/i);
    expect(() => resolveBrowserBuildIdentityV1({
      production: true,
      adapterSha: TEST_BUILD_SHA,
    })).toThrow(/must come from build-time VITE_LUPI_BUILD_SHA injection/i);
    expect(() => resolveBrowserBuildIdentityV1({
      production: false,
      adapterSha: TEST_BUILD_SHA,
      injectedSha: NEXT_BUILD_SHA,
    })).toThrow(/must match the VITE_LUPI_BUILD_SHA/i);
  });

  it('marks pinned and unpinned development identity as non-durable', () => {
    expect(resolveBrowserBuildIdentityV1({
      production: false,
      injectedSha: TEST_BUILD_SHA,
    })).toMatchObject({
      buildId: TEST_BUILD_SHA,
      durability: 'non-durable-development',
      source: 'vite-pinned-development',
    });
    expect(resolveBrowserBuildIdentityV1({ production: false })).toEqual({
      buildId: 'non-durable-development',
      gitSha: null,
      durability: 'non-durable-development',
      source: 'unversioned-development',
    });
  });

  it('changes the artifact key across exact build SHAs', async () => {
    const first = await plan();
    const second = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: NEXT_BUILD_SHA,
    });

    expect(first.specId).toBe(second.specId);
    expect(first.rendererFingerprint).not.toBe(second.rendererFingerprint);
    expect(first.artifactKey).not.toBe(second.artifactKey);
    expect(first.buildIdentity).toMatchObject({
      gitSha: TEST_BUILD_SHA,
      durability: 'non-durable-development',
      source: 'adapter-pinned-development',
    });
  });
});
