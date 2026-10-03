import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Frame, Trajectory } from '@atlas/core';
import { useStore, type LoadedFile } from '../store';
import type { LupiRendererRuntime } from '../viewer/createLupiRenderer';
import { EXECUTION_CLASS_V2, FIBER_VERSION_V2 } from '../export/exportProfileV2';
import { reportActiveTransmissionQuality } from './transmissionRuntime';
import {
  browserRendererRuntimeV2,
  canonicalArtifactCameraPlanesV1,
  createBrowserRenderArtifactPlanV1,
  createInlineBrowserDeliveryV1,
  resolveBrowserBuildIdentityV1,
} from './renderArtifactAdapter';

const { WEBGPU_RUNTIME, WEBGL2_RUNTIME, renderer } = vi.hoisted(() => {
  const webgpu: LupiRendererRuntime = {
    backend: 'webgpu',
    forced: false,
    adapterInfo: { vendor: 'google', architecture: 'swiftshader', device: '', description: 'SwiftShader' },
    preferredCanvasFormat: 'bgra8unorm',
    requestedLimits: {},
    compatibilityMode: false,
    samples: 0,
    compat: { swizzleRetry: false },
    three: '186',
  };
  return {
    WEBGPU_RUNTIME: webgpu,
    WEBGL2_RUNTIME: {
      ...webgpu,
      backend: 'webgl2',
      adapterInfo: null,
      preferredCanvasFormat: null,
      compatibilityMode: null,
    } satisfies LupiRendererRuntime,
    // The viewer's renderer record; null = no renderer has been created yet.
    renderer: { runtime: webgpu as LupiRendererRuntime | null },
  };
});
vi.mock('../viewer/createLupiRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../viewer/createLupiRenderer')>()),
  getLupiRendererRuntime: () => renderer.runtime,
}));

afterEach(() => {
  renderer.runtime = WEBGPU_RUNTIME;
});

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

  it('validates a GLB with bonds and records the drawn recipe; raster with bonds still throws', async () => {
    useStore.getState().reset();
    const file = loadedFile('salt.xyz');
    const frame = file.trajectory.frames[0]!;
    frame.bonds = new Int32Array(0);
    frame.types = new Int32Array([11, 8]);
    frame.positions = new Float32Array([0, 0, 0, 2.4, 0, 0]);
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'xyz-element-token' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
    frame.chemistry = { totalCharge: 1, spinMultiplicity: 1, source: 'file-declared', domain: null };
    frame.periodic = false;
    useStore.getState().setFile(file);
    useStore.setState({ playing: false, showBonds: true, showBondContacts: false, showKnowledgeLabels: false, annotations: [], ghostFile: null });

    const model = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'glb',
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(model.spec.layers.bonds).toBe(true);
    expect(model.spec.view.bonds).toMatchObject({
      topology: 'molecular-inference-v1',
      recipe: 'lupi-bonds.molecular.v1',
      contacts: false,
    });
    expect(model.spec.view.bonds).not.toHaveProperty('sourceBondCount');

    useStore.setState({ bondProfile: 'distance' });
    const distance = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'glb',
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(distance.spec.view.bonds).toMatchObject({ topology: 'covalent-inference-v1', recipe: 'lupi-bonds.distance.v1' });
    expect(distance.spec.view.bonds).not.toHaveProperty('contacts');
    expect(distance.specId).not.toBe(model.specId);

    await expect(createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    })).rejects.toThrow(/Hide bonds before deterministic raster export/);
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

  it('uses an origin-free module id and probes the descendant canvas on the WebGL2 backend', () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'lupi-viewer-canvas';
    const canvas = document.createElement('canvas');
    Object.defineProperty(canvas, 'getContext', { value: () => null });
    wrapper.append(canvas);
    document.body.append(wrapper);
    try {
      const runtime = browserRendererRuntimeV2(WEBGL2_RUNTIME);
      expect(runtime).toMatchObject({
        backend: 'webgl2',
        moduleId: '@atlas/ui/mcp/renderArtifactAdapter',
        webgl2: { status: 'context-unavailable' },
      });
      expect(runtime).not.toHaveProperty('moduleUrl');
      expect(browserRendererRuntimeV2(WEBGPU_RUNTIME)).toMatchObject({
        backend: 'webgpu',
        webgpu: { adapter: { description: 'SwiftShader' }, compatibilityMode: false },
      });
    } finally {
      wrapper.remove();
    }
  });

  it('gives each backend its own execution class, fingerprint and artifact key', async () => {
    const webgpu = await plan();
    renderer.runtime = WEBGL2_RUNTIME;
    const webgl2 = await createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    });
    expect(EXECUTION_CLASS_V2).toEqual({
      webgpu: 'browser-webgpu-main-thread',
      webgl2: 'browser-webgpu-webgl2-main-thread',
    });
    expect(webgl2.specId).toBe(webgpu.specId);
    expect(webgl2.rendererFingerprint).not.toBe(webgpu.rendererFingerprint);
    expect(webgl2.artifactKey).not.toBe(webgpu.artifactKey);
  });

  it('refuses an identity before the viewer renderer exists', async () => {
    await plan();
    renderer.runtime = null;
    await expect(createBrowserRenderArtifactPlanV1(useStore.getState(), {
      format: 'png', width: 320, height: 240, transparent: false,
      delivery: createInlineBrowserDeliveryV1(1_000_000), buildSha: TEST_BUILD_SHA,
    })).rejects.toThrow(/renderer has not started/);
  });

  it('pins the fiber version the viewer depends on', () => {
    const manifest = ['package.json', 'packages/ui/package.json']
      .map((path) => resolve(process.cwd(), path))
      .filter((path) => existsSync(path))
      .map((path) => JSON.parse(readFileSync(path, 'utf8')))
      .find((candidate) => candidate.name === '@atlas/ui');
    expect(manifest?.dependencies['@react-three/fiber']).toBe(FIBER_VERSION_V2);
  });

  it('fingerprints the effective transmission quality reported by the viewer', () => {
    expect(browserRendererRuntimeV2(WEBGPU_RUNTIME)).toMatchObject({ transmission: 'inactive' });
    try {
      // Byte-changing execution state: two tiers must produce two runtimes.
      reportActiveTransmissionQuality({ samples: 4, resolution: 256 });
      expect(browserRendererRuntimeV2(WEBGPU_RUNTIME)).toMatchObject({
        transmission: { samples: 4, resolution: 256 },
      });
      reportActiveTransmissionQuality({ samples: 6, resolution: 512 });
      expect(browserRendererRuntimeV2(WEBGPU_RUNTIME)).toMatchObject({
        transmission: { samples: 6, resolution: 512 },
      });
    } finally {
      reportActiveTransmissionQuality(null);
    }
    expect(browserRendererRuntimeV2(WEBGPU_RUNTIME)).toMatchObject({ transmission: 'inactive' });
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
