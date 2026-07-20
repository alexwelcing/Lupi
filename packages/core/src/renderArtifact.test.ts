import { describe, expect, it } from 'vitest';
import {
  MAX_RASTER_DIMENSION_V1,
  RENDER_ARTIFACT_KEY_VERSION_V1,
  RENDER_ARTIFACT_SPEC_VERSION_V1,
  RENDER_CAPABILITY_VERSION_V1,
  RENDER_DELIVERY_VERSION_V1,
  RENDER_LAYER_REGISTRY_V1,
  RENDER_REQUEST_VERSION_V1,
  RENDERER_FINGERPRINT_VERSION_V1,
  RenderArtifactValidationError,
  assertRenderCapabilitySupportsSpecV1,
  canonicalizeRenderValueV1,
  computeRenderArtifactKeyV1,
  computeRenderRequestKeyV1,
  computeRenderSpecIdV1,
  computeRendererFingerprintV1,
  createRenderLayerStateV1,
  decodeRenderArtifactBase64V1,
  renderArtifactKeyInputV1,
  renderSpecIdInputV1,
  validateRenderArtifactSpecV1,
  validateRenderCapabilityV1,
  validateRenderDeliveryV1,
  validateRenderRequestV1,
  validateRenderRequestSpecV1,
  validateRendererFingerprintInputV1,
  type RenderArtifactSpecV1,
  type RenderCapabilityV1,
  type RenderDeliveryV1,
  type RenderJsonObjectV1,
  type RenderLayerIdV1,
  type RendererFingerprintInputV1,
  type RenderRequestV1,
  type RenderRequestSpecV1,
} from './renderArtifact';

const SOURCE_DIGEST = `sha256:${'a'.repeat(64)}` as const;
const LAYER_DATA_DIGEST = `sha256:${'c'.repeat(64)}` as const;

function viewForLayer(
  layer: RenderLayerIdV1,
  variant = 'default',
): RenderJsonObjectV1 {
  const entry = RENDER_LAYER_REGISTRY_V1[layer];
  if (entry.canonicalStateField === 'source-only') return {};
  const state = (() => {
    switch (layer) {
      case 'background': return {
        top: variant === 'changed' ? '#222222' : '#111111',
        bottom: '#000000',
        media: { kind: 'gradient', projection: 'equirectangular' },
        style: 'linear',
        projectionMode: 'scene-background',
        dataDigest: LAYER_DATA_DIGEST,
      };
      case 'atoms': return {
        scale: 1,
        hiddenTypes: [],
        typeScales: {},
        colorSource: 'element',
        colorMode: 'type',
        colorProperty: null,
        colormap: 'viridis',
        uniformColor: variant === 'changed' ? '#eeeeee' : '#ffffff',
        elementColorOverrides: {},
        materialPreset: 'default',
        roughness: 0,
        polish: 0,
        propertyRange: [0, 1],
        propertyEmissionStrength: 0,
        materialIntensity: 1,
        texture: 'none',
        clearcoat: 0,
      };
      case 'vectorGlyphs': return { field: variant, scale: 1, density: 1, colormap: 'viridis' };
      case 'bonds': return {
        tolerance: 0.45,
        colorMode: variant === 'changed' ? 'length' : 'type',
        atomColorSource: 'element',
        atomColorMode: 'type',
        colorProperty: null,
        colormap: 'viridis',
        uniformColor: '#ffffff',
        elementColorOverrides: {},
        materialPreset: 'default',
        roughness: 0,
        polish: 0,
        execution: 'cpu-snapshot-v1',
        materialIntensity: 1,
        clearcoat: 0,
        appliedCount: 1,
      };
      case 'filterShell': return {
        shape: 'sphere',
        preset: variant === 'changed' ? 'cryo' : 'haze',
        opacity: 0.5,
        radiusScale: 1,
      };
      case 'moleculeShadow': return { opacity: 0.5, keyAzimuth: variant === 'changed' ? 1 : 0, keyElevation: 45 };
      case 'contactShadows': return {
        blur: 2.4,
        opacity: 0.32,
        resolution: 1024,
        color: variant === 'changed' ? '#111111' : '#000000',
      };
      case 'axes': return {
        kind: 'canvas-overlay-v1',
        alignment: 'bottom-left',
        radiusPolicy: '11pct-clamped-18-42',
        axisColors: ['#ff4060', '#40ff80', '#4080ff'],
        labelColor: 'white',
      };
      default: return {
        variant,
        ...(entry.dataDigest === 'separate-required' ? { dataDigest: LAYER_DATA_DIGEST } : {}),
      };
    }
  })() as unknown as RenderJsonObjectV1;
  return { [entry.canonicalStateField.slice('view.'.length)]: state };
}

const COMMON_RASTER_VIEW: RenderJsonObjectV1 = {
  camera: { position: [10, 10, 10], target: [0, 0, 0], fov: 45, near: 0.1, far: 10_000 },
  lighting: {
    ambient: 0.6,
    directional: 0.8,
    rim: 0.4,
    keyAzimuth: 35,
    keyElevation: 45,
    fillAzimuth: -45,
    fillElevation: 25,
    rimAzimuth: 135,
    rimElevation: 35,
    fillColor: '#ffffff',
    rimColor: '#ffffff',
    environment: { preset: 'none' },
  },
  postprocess: {
    pipeline: 'raw-scene',
    toneMapping: 'none',
    multisampling: 0,
    outputColorSpace: 'srgb',
  },
};

function rasterView(...parts: RenderJsonObjectV1[]): RenderJsonObjectV1 {
  return Object.assign({}, COMMON_RASTER_VIEW, ...parts);
}

function modelView(format: 'glb' | 'usdz' = 'glb'): RenderJsonObjectV1 {
  return {
    atoms: {
      scale: 1,
      hiddenTypes: [],
      typeScales: {},
      colorSource: 'element',
      colorMode: 'type',
      colorProperty: null,
      colormap: 'viridis',
      uniformColor: '#ffffff',
      elementColorOverrides: {},
      materialPreset: 'default',
      roughness: 0,
      polish: 0,
      propertyRange: [0, 1],
      geometryPolicy: format === 'usdz' ? 'usdz-ar-framed-v1' : 'glb-world-space-v1',
    },
  };
}

function contentSpec(
  overrides: Partial<RenderArtifactSpecV1> = {},
): RenderArtifactSpecV1 {
  return {
    version: RENDER_ARTIFACT_SPEC_VERSION_V1,
    source: {
      kind: 'content',
      mediaType: 'chemical/x-xyz',
      contentDigest: SOURCE_DIGEST,
    },
    format: 'png',
    width: 1024,
    height: 768,
    alpha: 'opaque',
    frame: 0,
    layers: createRenderLayerStateV1(['background', 'atoms']),
    view: rasterView(
      viewForLayer('background'),
      viewForLayer('atoms'),
    ),
    ...overrides,
  };
}

function delivery(overrides: Partial<RenderDeliveryV1> = {}): RenderDeliveryV1 {
  return {
    version: RENDER_DELIVERY_VERSION_V1,
    inline: true,
    maxInlineBytes: 8 * 1024 * 1024,
    sync: false,
    filename: 'caffeine.png',
    ...overrides,
  };
}

function request(
  spec: RenderRequestSpecV1 = contentSpec(),
  requestDelivery: RenderDeliveryV1 = delivery(),
): RenderRequestV1 {
  return {
    version: RENDER_REQUEST_VERSION_V1,
    spec,
    delivery: requestDelivery,
  };
}

function capability(): RenderCapabilityV1 {
  return {
    version: RENDER_CAPABILITY_VERSION_V1,
    formats: {
      png: {
        enabled: true,
        alphaModes: ['opaque', 'transparent'],
        maxWidth: MAX_RASTER_DIMENSION_V1,
        maxHeight: MAX_RASTER_DIMENSION_V1,
      },
      jpeg: {
        enabled: true,
        alphaModes: ['opaque'],
        maxWidth: 2048,
        maxHeight: 2048,
      },
      webp: {
        enabled: true,
        alphaModes: ['opaque', 'transparent'],
        maxWidth: MAX_RASTER_DIMENSION_V1,
        maxHeight: MAX_RASTER_DIMENSION_V1,
      },
      glb: { enabled: true, alphaModes: ['not-applicable'] },
      usdz: { enabled: false, alphaModes: [] },
    },
    layers: Object.fromEntries(
      Object.entries(RENDER_LAYER_REGISTRY_V1).map(([layer, entry]) => [
        layer,
        entry.support === 'supported',
      ]),
    ) as RenderCapabilityV1['layers'],
  };
}

function fingerprintInput(
  overrides: Partial<RendererFingerprintInputV1> = {},
): RendererFingerprintInputV1 {
  return {
    version: RENDERER_FINGERPRINT_VERSION_V1,
    renderer: 'lupi-browser',
    rendererVersion: 'three-r180',
    buildId: 'git-5ffe651e',
    executionClass: 'browser-webgl-main-thread',
    runtime: { browser: 'chromium-test', gpu: 'swiftshader-test' },
    determinism: { pixelRatio: 1, outputColorSpace: 'srgb', toneMapping: 'none' },
    capability: capability(),
    ...overrides,
  };
}

describe('render artifact V1 canonicalization', () => {
  it('sorts object keys recursively while preserving array order', () => {
    expect(canonicalizeRenderValueV1({ z: 1, a: { y: 2, x: [3, 1] }, m: -0 })).toBe(
      '{"a":{"x":[3,1],"y":2},"m":0,"z":1}',
    );
  });

  it('rejects lossy values and cycles', () => {
    expect(() => canonicalizeRenderValueV1({ missing: undefined })).toThrow(/unsupported canonical value/);
    expect(() => canonicalizeRenderValueV1({ invalid: Number.NaN })).toThrow(/finite JSON number/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalizeRenderValueV1(cyclic)).toThrow(/cycle/);

    const symbolKeyed = { visible: true, [Symbol('hidden')]: true };
    expect(() => canonicalizeRenderValueV1(symbolKeyed)).toThrow(/symbol keys/);
  });
});

describe('render artifact V1 semantic validation', () => {
  it('names every visible viewer layer and returns a complete explicit state', () => {
    expect(Object.keys(RENDER_LAYER_REGISTRY_V1)).toEqual([
      'background',
      'atoms',
      'vectorGlyphs',
      'atomClusters',
      'bonds',
      'simulationCell',
      'filterShell',
      'moleculeShadow',
      'contactShadows',
      'ghostAtoms',
      'annotations',
      'knowledgeLabels',
      'selectionMarkers',
      'atomTrails',
      'axes',
      'scaleBar',
    ]);
    const layers = createRenderLayerStateV1(['atoms', 'axes']);
    expect(Object.keys(layers)).toEqual(Object.keys(RENDER_LAYER_REGISTRY_V1));
    expect(layers.atoms).toBe(true);
    expect(layers.axes).toBe(true);
    expect(layers.bonds).toBe(false);
    for (const [layer, entry] of Object.entries(RENDER_LAYER_REGISTRY_V1)) {
      expect(
        entry.canonicalStateField === 'source-only'
        || entry.canonicalStateField === `view.${layer}`,
      ).toBe(true);
      expect(['supported', 'unsupported']).toContain(entry.support);
      expect(['source-content', 'canonical-state', 'separate-required']).toContain(entry.dataDigest);
      expect(['enabled', 'disabled', 'derived']).toContain(entry.resetDefault);
    }
    expect(RENDER_LAYER_REGISTRY_V1.background).toMatchObject({
      support: 'supported',
      canonicalStateField: 'view.background',
      dataDigest: 'separate-required',
    });
    expect(RENDER_LAYER_REGISTRY_V1.ghostAtoms).toMatchObject({
      support: 'unsupported',
      dataDigest: 'separate-required',
    });
  });

  it('requires canonical state for every enabled supported layer', () => {
    for (const layer of Object.keys(RENDER_LAYER_REGISTRY_V1) as RenderLayerIdV1[]) {
      const entry = RENDER_LAYER_REGISTRY_V1[layer];
      if (entry.support === 'unsupported') continue;
      const layers = createRenderLayerStateV1([layer]);
      const view = rasterView(viewForLayer(layer));
      expect(() => validateRenderArtifactSpecV1(contentSpec({ layers, view }))).not.toThrow();
      if (entry.canonicalStateField !== 'source-only') {
        expect(() => validateRenderArtifactSpecV1(contentSpec({ layers, view: rasterView() }))).toThrow(
          new RegExp(`view\\.${layer}.*required`),
        );
      }
    }
  });

  it('requires disabled layer state to be absent from canonical view state', () => {
    expect(() => validateRenderArtifactSpecV1(contentSpec({
      layers: createRenderLayerStateV1(['atoms']),
      view: rasterView(viewForLayer('atoms'), viewForLayer('scaleBar')),
    }))).toThrow(/view\.scaleBar.*must be absent/);
  });

  it('rejects invalid canonical view types, enums, and ranges before hashing', () => {
    const base = contentSpec();
    const atoms = base.view.atoms as RenderJsonObjectV1;
    const camera = base.view.camera as RenderJsonObjectV1;
    const invalidAtoms = [
      [{ ...atoms, scale: 'banana' }, /atoms\.scale.*finite number/],
      [{ ...atoms, colorMode: 'element' }, /atoms\.colorMode.*must be one of/],
      [{ ...atoms, propertyRange: [2, 1] }, /atoms\.propertyRange.*ordered/],
      [{ ...atoms, hiddenTypes: [1, 1] }, /atoms\.hiddenTypes.*duplicates/],
      [{ ...atoms, typeScales: { 6: 99 } }, /atoms\.typeScales\.6.*0\.1 through 8/],
    ] as const;
    for (const [invalid, expected] of invalidAtoms) {
      expect(() => validateRenderArtifactSpecV1({
        ...base,
        view: { ...base.view, atoms: invalid },
      })).toThrow(expected);
    }
    expect(() => validateRenderArtifactSpecV1({
      ...base,
      view: { ...base.view, camera: { ...camera, fov: 180 } },
    })).toThrow(/camera\.fov.*1 through 179/);
    expect(() => validateRenderArtifactSpecV1({
      ...base,
      view: { ...base.view, camera: { ...camera, near: 0 } },
    })).toThrow(/camera\.near.*greater than zero/);
    expect(() => validateRenderArtifactSpecV1({
      ...base,
      view: { ...base.view, camera: { ...camera, far: camera.near } },
    })).toThrow(/camera\.far.*greater than camera\.near/);
  });

  it('requires explicit legal raster dimensions and alpha modes', () => {
    expect(validateRenderArtifactSpecV1(contentSpec())).toEqual(contentSpec());
    expect(() => validateRenderArtifactSpecV1(contentSpec({ width: 32 }))).toThrow(/64 through 4096/);
    expect(() => validateRenderArtifactSpecV1(contentSpec({ format: 'jpeg', alpha: 'transparent' }))).toThrow(
      /must be one of opaque/,
    );
    const missingHeight = { ...contentSpec() } as Record<string, unknown>;
    delete missingHeight.height;
    expect(() => validateRenderArtifactSpecV1(missingHeight)).toThrow(/spec.height/);
  });

  it('forbids raster dimensions and background alpha semantics on model formats', () => {
    const model = contentSpec({
      format: 'glb',
      alpha: 'not-applicable',
      width: undefined,
      height: undefined,
      layers: createRenderLayerStateV1(['atoms']),
      view: modelView('glb'),
    });
    const modelValue = { ...model } as Record<string, unknown>;
    delete modelValue.width;
    delete modelValue.height;
    expect(validateRenderArtifactSpecV1(modelValue)).toMatchObject({ format: 'glb', alpha: 'not-applicable' });

    expect(() => validateRenderArtifactSpecV1({ ...modelValue, width: 1024 })).toThrow(
      /must not declare raster dimensions/,
    );
    expect(() => validateRenderArtifactSpecV1({ ...modelValue, alpha: 'opaque' })).toThrow(
      /must be one of not-applicable/,
    );
  });

  it('rejects unknown fields and incomplete layer declarations', () => {
    expect(() => validateRenderArtifactSpecV1({ ...contentSpec(), quality: 1 })).toThrow(
      /unsupported field quality/,
    );
    const layers = { ...contentSpec().layers } as Record<string, boolean>;
    delete layers.axes;
    expect(() => validateRenderArtifactSpecV1({ ...contentSpec(), layers })).toThrow(
      /missing required field axes/,
    );
    expect(() => validateRenderArtifactSpecV1({
      ...contentSpec(),
      layers: { ...layers, axes: true, futureLayer: true },
    })).toThrow(/unsupported field futureLayer/);
  });

  it('requires decoded content to carry a valid digest', () => {
    expect(() => validateRenderArtifactSpecV1(contentSpec({
      source: { kind: 'content', mediaType: 'chemical/x-xyz', contentDigest: 'sha256:abc' },
    }))).toThrow(/invalid SHA-256/);
  });

  it('rejects enabled dynamic layers whose data is not content-addressed by V1', () => {
    expect(() => validateRenderArtifactSpecV1(contentSpec({
      layers: createRenderLayerStateV1(['atoms', 'ghostAtoms']),
      view: rasterView(viewForLayer('atoms'), viewForLayer('ghostAtoms')),
    }))).toThrow(/enabled layer ghostAtoms is unsupported by the V1 artifact contract/);
  });

  it('validates delivery preferences separately and rejects path-like filenames', () => {
    expect(validateRenderDeliveryV1(delivery())).toEqual(delivery());
    expect(() => validateRenderDeliveryV1(delivery({ filename: '../caffeine.png' }))).toThrow(/basename/);
    expect(() => validateRenderDeliveryV1({ ...delivery(), cacheKey: 'wrong-owner' })).toThrow(
      /unsupported field cacheKey/,
    );
  });

  it('validates the complete request boundary', () => {
    expect(validateRenderRequestV1(request())).toEqual(request());
    expect(() => validateRenderRequestV1({ ...request(), version: 'v2' })).toThrow(/lupi.render-request.v1/);
  });
});

describe('renderer capability and fingerprint V1', () => {
  it('requires every format and every named layer to be explicit', () => {
    expect(validateRenderCapabilityV1(capability())).toEqual(capability());
    const layers = { ...capability().layers } as Record<string, boolean>;
    delete layers.atomTrails;
    expect(() => validateRenderCapabilityV1({ ...capability(), layers })).toThrow(
      /missing required field atomTrails/,
    );
    const formats = { ...capability().formats } as Record<string, unknown>;
    delete formats.webp;
    expect(() => validateRenderCapabilityV1({ ...capability(), formats })).toThrow(
      /missing required field webp/,
    );
    expect(() => validateRenderCapabilityV1({
      ...capability(),
      layers: { ...capability().layers, ghostAtoms: true },
    })).toThrow(/cannot claim unsupported V1 layer ghostAtoms/);
  });

  it('rejects enabled layers the renderer cannot produce but permits disabled ones', () => {
    const limited = capability();
    const layers = { ...limited.layers, bonds: false };
    const limitedCapability = { ...limited, layers };
    expect(() => assertRenderCapabilitySupportsSpecV1(limitedCapability, contentSpec({
      layers: createRenderLayerStateV1(['atoms', 'bonds']),
      view: rasterView(viewForLayer('atoms'), viewForLayer('bonds')),
    }))).toThrow(/enabled layer bonds is unsupported/);
    expect(() => assertRenderCapabilitySupportsSpecV1(limitedCapability, contentSpec({
      layers: createRenderLayerStateV1(['atoms']),
      view: rasterView(viewForLayer('atoms')),
    }))).not.toThrow();
  });

  it('rejects format, alpha, and dimension claims beyond renderer capability', () => {
    expect(() => assertRenderCapabilitySupportsSpecV1(capability(), contentSpec({
      format: 'jpeg',
      alpha: 'opaque',
      width: 3000,
      height: 1000,
    }))).toThrow(/exceeds this renderer/);

    const baseCapability = capability();
    const noTransparentPng = {
      ...baseCapability,
      formats: {
        ...baseCapability.formats,
        png: { ...baseCapability.formats.png, alphaModes: ['opaque'] as const },
      },
    };
    expect(() => assertRenderCapabilitySupportsSpecV1(noTransparentPng, contentSpec({
      alpha: 'transparent',
      layers: createRenderLayerStateV1(['atoms']),
      view: rasterView(viewForLayer('atoms')),
    }))).toThrow(
      /transparent is unsupported/,
    );
  });

  it('validates and hashes renderer build plus capability deterministically', async () => {
    expect(validateRendererFingerprintInputV1(fingerprintInput())).toEqual(fingerprintInput());
    const first = await computeRendererFingerprintV1(fingerprintInput());
    const same = await computeRendererFingerprintV1(fingerprintInput());
    const changed = await computeRendererFingerprintV1(fingerprintInput({ buildId: 'git-next' }));
    expect(first).toMatch(/^renderer-sha256:[0-9a-f]{64}$/);
    expect(same).toBe(first);
    expect(changed).not.toBe(first);

    const reorderedAlphaModes = capability();
    const reorderedInput = fingerprintInput({
      capability: {
        ...reorderedAlphaModes,
        formats: {
          ...reorderedAlphaModes.formats,
          png: {
            ...reorderedAlphaModes.formats.png,
            alphaModes: ['transparent', 'opaque'],
          },
        },
      },
    });
    expect(await computeRendererFingerprintV1(reorderedInput)).toBe(first);
  });
});

describe('render identity V1', () => {
  it('is stable across insertion order and excludes every delivery field', async () => {
    const reordered = contentSpec({
      view: {
        ...viewForLayer('atoms'),
        postprocess: COMMON_RASTER_VIEW.postprocess,
        ...viewForLayer('background'),
        lighting: COMMON_RASTER_VIEW.lighting,
        camera: { fov: 45, target: [0, 0, 0], position: [10, 10, 10], near: 0.1, far: 10_000 },
      },
    });
    expect(renderSpecIdInputV1(reordered)).toBe(renderSpecIdInputV1(contentSpec()));
    expect(await computeRenderSpecIdV1(reordered)).toBe(await computeRenderSpecIdV1(contentSpec()));

    const inline = request(contentSpec(), delivery());
    const urlOnly = request(contentSpec(), delivery({
      inline: false,
      maxInlineBytes: 1024,
      sync: true,
      filename: 'renamed.webp',
    }));
    expect(await computeRenderRequestKeyV1(urlOnly)).toBe(await computeRenderRequestKeyV1(inline));
  });

  it('changes specId for every normalized render-affecting field', async () => {
    const baseline = contentSpec();
    const baselineId = await computeRenderSpecIdV1(baseline);
    const variants: RenderArtifactSpecV1[] = [
      contentSpec({
        source: {
          kind: 'content',
          mediaType: 'chemical/x-xyz',
          contentDigest: `sha256:${'b'.repeat(64)}`,
        },
      }),
      contentSpec({ width: 1025 }),
      contentSpec({
        alpha: 'transparent',
        layers: createRenderLayerStateV1(['atoms']),
        view: rasterView(viewForLayer('atoms')),
      }),
      contentSpec({ frame: 1 }),
      contentSpec({
        layers: createRenderLayerStateV1(['atoms']),
        view: rasterView(viewForLayer('atoms')),
      }),
      contentSpec({
        view: {
          ...contentSpec().view,
          camera: { position: [0, 10, 0], target: [0, 0, 0], fov: 45, near: 0.1, far: 10_000 },
        },
      }),
    ];
    for (const variant of variants) {
      await expect(computeRenderSpecIdV1(variant)).resolves.not.toBe(baselineId);
    }
  });

  it('changes specId when any enabled layer canonical state changes', async () => {
    for (const layer of Object.keys(RENDER_LAYER_REGISTRY_V1) as RenderLayerIdV1[]) {
      const entry = RENDER_LAYER_REGISTRY_V1[layer];
      if (entry.support === 'unsupported') continue;
      const layers = createRenderLayerStateV1([layer]);
      if (entry.canonicalStateField === 'source-only') {
        const first = contentSpec({ layers, view: rasterView() });
        const changed = contentSpec({
          layers,
          view: rasterView(),
          source: {
            kind: 'content',
            mediaType: 'chemical/x-xyz',
            contentDigest: `sha256:${'d'.repeat(64)}`,
          },
        });
        expect(await computeRenderSpecIdV1(changed)).not.toBe(await computeRenderSpecIdV1(first));
        continue;
      }
      const first = contentSpec({ layers, view: rasterView(viewForLayer(layer, 'first')) });
      const changed = contentSpec({
        layers,
        view: layer === 'axes'
          ? {
            ...rasterView(viewForLayer(layer, 'changed')),
            camera: { position: [0, 10, 0], target: [0, 0, 0], fov: 45, near: 0.1, far: 10_000 },
          }
          : rasterView(viewForLayer(layer, 'changed')),
      });
      expect(await computeRenderSpecIdV1(changed)).not.toBe(await computeRenderSpecIdV1(first));
    }
  });

  it('gives a mutable source only a request key until content is resolved', async () => {
    const unresolved: RenderRequestSpecV1 = {
      ...contentSpec(),
      source: { kind: 'reference', uri: 'https://example.test/current.xyz' },
    };
    expect(validateRenderRequestSpecV1(unresolved)).toEqual(unresolved);
    expect(validateRenderRequestV1(request(unresolved)).spec).toEqual(unresolved);
    expect(() => validateRenderArtifactSpecV1(unresolved)).toThrow(
      /finalized artifact specs require immutable decoded content/,
    );
    await expect(computeRenderRequestKeyV1(request(unresolved))).resolves.toMatch(
      /^request-sha256:[0-9a-f]{64}$/,
    );
    await expect(computeRenderSpecIdV1(unresolved)).rejects.toThrow(
      /finalized artifact specs require immutable decoded content/,
    );
  });

  it('combines only specId and renderer fingerprint into artifactKey', async () => {
    const specId = await computeRenderSpecIdV1(contentSpec());
    const rendererFingerprint = await computeRendererFingerprintV1(fingerprintInput());
    const input = { specId, rendererFingerprint };
    expect(renderArtifactKeyInputV1(input)).toBe(
      `{"rendererFingerprint":"${rendererFingerprint}","specId":"${specId}","version":"${RENDER_ARTIFACT_KEY_VERSION_V1}"}`,
    );
    const first = await computeRenderArtifactKeyV1(input);
    const same = await computeRenderArtifactKeyV1(input);
    const otherRenderer = await computeRendererFingerprintV1(fingerprintInput({ buildId: 'git-next' }));
    const changed = await computeRenderArtifactKeyV1({ specId, rendererFingerprint: otherRenderer });
    expect(first).toMatch(/^artifact-sha256:[0-9a-f]{64}$/);
    expect(same).toBe(first);
    expect(changed).not.toBe(first);
  });
});

describe('decoded artifact digest V1', () => {
  it('hashes decoded bytes rather than their base64 transport', async () => {
    const decoded = await decodeRenderArtifactBase64V1('aGVsbG8=');
    expect(new TextDecoder().decode(decoded.bytes)).toBe('hello');
    expect(decoded.artifactDigest).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('rejects absent, empty, and non-canonical encoded content', async () => {
    await expect(decodeRenderArtifactBase64V1('')).rejects.toBeInstanceOf(RenderArtifactValidationError);
    await expect(decodeRenderArtifactBase64V1('aGVsbG8')).rejects.toThrow(/canonical padded base64/);
    await expect(decodeRenderArtifactBase64V1('!!!!')).rejects.toThrow(/canonical padded base64/);
  });
});
