import { describe, it, expect, beforeEach } from 'vitest';
import { resetStore, getStoreState, setStoreState } from './test-utils';
import { createMockTrajectory } from '@atlas/core/test-utils';
import { DEFAULT_SCENE_ID } from '@atlas/scene/materials';
import { getDefaultVectorDensity } from './store';

function encodeStateDelta(delta: Record<string, unknown>) {
  return btoa(JSON.stringify(delta))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function encodeRawStateJson(json: string) {
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function markChemicalTrajectory(trajectory: ReturnType<typeof createMockTrajectory>) {
  for (const frame of trajectory.frames) {
    if (!frame) continue;
    frame.typeSemantics = { kind: 'atomic-number', provenance: 'source-element-symbol' };
    frame.distanceSemantics = { kind: 'angstrom', provenance: 'format-convention' };
  }
  return trajectory;
}

describe('Store - vector field defaults', () => {
  it.each([
    { atomCount: 60, expected: 1 },
    { atomCount: 864, expected: 0.35 },
    { atomCount: 10_000, expected: 0.03 },
    { atomCount: 953_312, expected: 0.01 },
    { atomCount: 0, expected: 1 },
  ])('targets a readable deterministic sample for $atomCount atoms', ({ atomCount, expected }) => {
    expect(getDefaultVectorDensity(atomCount)).toBe(expected);
  });
});

describe('Store — Display Toggles', () => {
  beforeEach(() => {
    resetStore();
  });

  it('toggles bonds on/off', () => {
    const s = getStoreState();
    expect(s.showBonds).toBe(false);

    s.toggleBonds();
    expect(getStoreState().showBonds).toBe(true);

    s.toggleBonds();
    expect(getStoreState().showBonds).toBe(false);
  });

  it('toggles cell visibility', () => {
    const s = getStoreState();
    expect(s.showCell).toBe(true);

    s.toggleCell();
    expect(getStoreState().showCell).toBe(false);
  });

  it('toggles axes visibility', () => {
    const s = getStoreState();
    expect(s.showAxes).toBe(true);

    s.toggleAxes();
    expect(getStoreState().showAxes).toBe(false);
  });
});

describe('Store — Bond Settings', () => {
  beforeEach(() => {
    resetStore();
  });

  it('sets bond cutoff', () => {
    getStoreState().setBondCutoff(3.5);
    expect(getStoreState().bondCutoff).toBe(3.5);
  });

  it('sets bond tolerance (the slider new role)', () => {
    // Default mirrors the worker's previous hard-coded slack so existing
    // scenes detect the same bond set out of the box.
    expect(getStoreState().bondTolerance).toBe(0.45);
    getStoreState().setBondTolerance(0.2);
    expect(getStoreState().bondTolerance).toBe(0.2);
    getStoreState().setBondTolerance(1.0);
    expect(getStoreState().bondTolerance).toBe(1.0);
  });
});

describe('Store — Playback', () => {
  beforeEach(() => {
    resetStore();
  });

  it('toggles play state', () => {
    const s = getStoreState();
    expect(s.playing).toBe(false);

    s.togglePlay();
    expect(getStoreState().playing).toBe(true);
  });

  it('sets playback speed', () => {
    getStoreState().setPlaybackSpeed(2.5);
    expect(getStoreState().playbackSpeed).toBe(2.5);
  });
});

describe('Store — Color & Visuals', () => {
  beforeEach(() => {
    resetStore();
  });

  it('sets colormap', () => {
    getStoreState().setColormap('inferno');
    expect(getStoreState().colormap).toBe('inferno');
    expect(getStoreState().activeProfile).toBeNull();
  });

  it('color scheme drives the atom color source', () => {
    getStoreState().setColorScheme('colorway');

    const s = getStoreState();
    expect(s.colorScheme).toBe('colorway');
    expect(s.atomColorSource).toBe('colormap');
  });

  it('applies neon visual profile', () => {
    getStoreState().applyVisualProfile('neon');
    const s = getStoreState();
    expect(s.activeProfile).toBe('neon');
    expect(s.bloom).toBe(true);
    expect(s.bloomIntensity).toBe(0.6);
    expect(s.environmentPreset).toBe('none');
  });
});

describe('Store — URL Serialization', () => {
  beforeEach(() => {
    resetStore();
  });

  it('encodes default state to empty-ish string', () => {
    const encoded = getStoreState().encodeToURL();
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('round-trips bond settings through URL', () => {
    const s = getStoreState();
    s.toggleBonds();
    s.setBondCutoff(3.2);
    s.setBondTolerance(0.7);

    const encoded = s.encodeToURL();
    resetStore();

    getStoreState().decodeFromURL(encoded);
    const restored = getStoreState();

    expect(restored.showBonds).toBe(true);
    expect(restored.bondCutoff).toBeCloseTo(3.2);
    expect(restored.bondTolerance).toBeCloseTo(0.7);
  });

  it('round-trips shareable look settings through URL', () => {
    const s = getStoreState();
    s.setColorScheme('uniform');
    s.setUniformAtomColor('#ff8844');
    s.setPostprocessPreset('cinematic');
    s.setPostprocessIntensity(1.35);
    s.setMaterialScene('forge');
    s.setMaterialPreset('metallic');
    s.setMaterialIntensity(0.42);
    s.setEnvironmentPreset('warehouse');
    s.setBackgroundPreset('void');
    s.setBackgroundStyle('spotlight');
    s.setBackgroundMotionPaused(true);
    s.setBackgroundMotionSpeed(0.45);
    s.setBackgroundOpacity(0.72);
    s.setBackgroundBrightness(1.24);
    s.setBackgroundSaturation(1.38);
    s.setBackgroundContrast(0.86);
    s.setBackgroundYawDegrees(74);
    s.setBackgroundPitchDegrees(-12);
    s.setBackgroundBackdropShape('cube');
    s.setBackgroundBackdropPattern('grid');
    s.setBackgroundBackdropRadius(3.4);
    s.setRimLightIntensity(0.75);
    s.setFillLightColor('#223344');
    s.setRimLightColor('#ddeeff');

    const encoded = s.encodeToURL();
    resetStore();
    getStoreState().decodeFromURL(encoded);
    const restored = getStoreState();

    expect(restored.colorScheme).toBe('uniform');
    expect(restored.uniformAtomColor).toBe('#ff8844');
    expect(restored.postprocessPreset).toBe('cinematic');
    expect(restored.postprocessIntensity).toBeCloseTo(1.35);
    expect(restored.materialScene).toBe('forge');
    expect(restored.materialPreset).toBe('metallic');
    expect(restored.materialIntensity).toBeCloseTo(0.42);
    expect(restored.environmentPreset).toBe('warehouse');
    expect(restored.backgroundPreset).toBe('void');
    expect(restored.backgroundStyle).toBe('spotlight');
    expect(restored.backgroundMotionPaused).toBe(true);
    expect(restored.backgroundMotionSpeed).toBeCloseTo(0.45);
    expect(restored.backgroundOpacity).toBeCloseTo(0.72);
    expect(restored.backgroundBrightness).toBeCloseTo(1.24);
    expect(restored.backgroundSaturation).toBeCloseTo(1.38);
    expect(restored.backgroundContrast).toBeCloseTo(0.86);
    expect(restored.backgroundYawDegrees).toBeCloseTo(74);
    expect(restored.backgroundPitchDegrees).toBeCloseTo(-12);
    expect(restored.backgroundBackdropShape).toBe('cube');
    expect(restored.backgroundBackdropPattern).toBe('grid');
    expect(restored.backgroundBackdropRadius).toBeCloseTo(3.4);
    expect(restored.rimLightIntensity).toBeCloseTo(0.75);
    expect(restored.fillLightColor).toBe('#223344');
    expect(restored.rimLightColor).toBe('#ddeeff');
  });

  it('sanitizes invalid look settings from URL state', () => {
    getStoreState().decodeFromURL(encodeStateDelta({
      ms: 'missing-scene',
      mp: 'mirror-metal',
      env: 'orbital',
    }));

    const restored = getStoreState();
    expect(restored.materialScene).toBe(DEFAULT_SCENE_ID);
    expect(restored.materialPreset).toBe('default');
    expect(restored.environmentPreset).toBe('studio');
  });

  it('maps the retired apartment environment onto the softbox studio', () => {
    getStoreState().decodeFromURL(encodeStateDelta({ env: 'apartment' }));
    expect(getStoreState().environmentPreset).toBe('softbox');

    getStoreState().setEnvironmentPreset('apartment' as never);
    expect(getStoreState().environmentPreset).toBe('softbox');

    getStoreState().setEnvironmentPreset('softbox');
    expect(getStoreState().environmentPreset).toBe('softbox');
  });

  it('infers color scheme for legacy URL color state', () => {
    getStoreState().decodeFromURL(encodeStateDelta({
      cm: 'property',
      cp: 'energy',
      cmap: 'turbo',
    }));

    let restored = getStoreState();
    expect(restored.colorScheme).toBe('property');
    expect(restored.atomColorSource).toBe('colormap');
    expect(restored.colorMode).toBe('property');
    expect(restored.colorProperty).toBe('energy');

    resetStore();
    getStoreState().decodeFromURL(encodeStateDelta({
      cm: 'type',
      cmap: 'plasma',
    }));

    restored = getStoreState();
    expect(restored.colorScheme).toBe('colorway');
    expect(restored.atomColorSource).toBe('colormap');
    expect(restored.colorMode).toBe('type');
    expect(restored.colormap).toBe('plasma');
  });

  it('migrates the legacy "family" color scheme id to "colorway"', () => {
    resetStore();
    getStoreState().decodeFromURL(encodeStateDelta({ cs: 'family' }));
    expect(getStoreState().colorScheme).toBe('colorway');
  });

  it('rejects wrong types, nulls, non-finite values, and out-of-range numbers', () => {
    const before = getStoreState();
    const defaults = {
      frame: before.frame,
      atomScale: before.atomScale,
      playbackSpeed: before.playbackSpeed,
      cameraFov: before.cameraFov,
      postprocessIntensity: before.postprocessIntensity,
      ssaoIntensity: before.ssaoIntensity,
      bloomIntensity: before.bloomIntensity,
      dofFocus: before.dofFocus,
      filterShellOpacity: before.filterShellOpacity,
      filterShellRadius: before.filterShellRadius,
      bondCutoff: before.bondCutoff,
      bondTolerance: before.bondTolerance,
      materialIntensity: before.materialIntensity,
      ambientLightIntensity: before.ambientLightIntensity,
      dirLightIntensity: before.dirLightIntensity,
      rimLightIntensity: before.rimLightIntensity,
      surfaceRoughness: before.surfaceRoughness,
      surfacePolish: before.surfacePolish,
      surfaceClearcoat: before.surfaceClearcoat,
      keyLightAzimuth: before.keyLightAzimuth,
      keyLightElevation: before.keyLightElevation,
      ssao: before.ssao,
      bloom: before.bloom,
      dof: before.dof,
      showCell: before.showCell,
      showAxes: before.showAxes,
      showBonds: before.showBonds,
      backgroundMotionPaused: before.backgroundMotionPaused,
    };

    getStoreState().decodeFromURL(encodeStateDelta({
      f: 1.5, as: '2', spd: null, fov: true, pi: '', si: 5, bi: -1, df: 10_001,
      fso: Number.NaN, fsr: Number.POSITIVE_INFINITY, bc: -2, bt: 4, mi: '0.5',
      ali: -1, dli: 5, rli: 5, sr: 2, sp: -2, scc: 2, kla: 361, kle: -91,
      ssao: '0', bloom: null, dof: '1', cell: false, axes: '0', bonds: true, bmp: '1',
    }));

    expect(getStoreState()).toMatchObject(defaults);
  });

  it('rejects malformed, non-finite, and huge camera vectors', () => {
    getStoreState().decodeFromURL(encodeStateDelta({ cp3: [1, 2], ct: [0, 0, 1_000_001] }));
    expect(getStoreState().cameraPosition).toEqual([0, 0, 50]);
    expect(getStoreState().cameraTarget).toEqual([0, 0, 0]);

    getStoreState().decodeFromURL(encodeRawStateJson('{"cp3":[0,1e309,0],"ct":[0,0,0]}'));
    expect(getStoreState().cameraPosition).toEqual([0, 0, 50]);
    expect(getStoreState().cameraTarget).toEqual([0, 0, 0]);
  });

  it('rejects oversized encoded URL state without changing viewer state', () => {
    getStoreState().setAtomScale(1.75);
    getStoreState().decodeFromURL('A'.repeat(65_537));
    expect(getStoreState().atomScale).toBe(1.75);
  });

  it('accepts documented numeric boundaries and preserves negative material values', () => {
    getStoreState().decodeFromURL(encodeStateDelta({
      f: 10_000_000, as: 20, spd: 0.0625, fov: 179, si: 4, bi: 0, df: 10_000,
      fso: 0.65, fsr: 4, mi: 1, ali: 4, dli: 0, rli: 4, sr: -1, sp: -1,
      scc: 1, kla: -360, kle: 90, cp3: [-1_000_000, 0, 1_000_000], ct: [1, 2, 3],
    }));
    expect(getStoreState()).toMatchObject({
      frame: 10_000_000, atomScale: 20, playbackSpeed: 0.0625, cameraFov: 179,
      ssaoIntensity: 4, bloomIntensity: 0, dofFocus: 10_000, filterShellOpacity: 0.65,
      filterShellRadius: 4, materialIntensity: 1, ambientLightIntensity: 4,
      dirLightIntensity: 0, rimLightIntensity: 4, surfaceRoughness: -1,
      surfacePolish: -1, surfaceClearcoat: 1, keyLightAzimuth: -360,
      keyLightElevation: 90, cameraPosition: [-1_000_000, 0, 1_000_000],
      cameraTarget: [1, 2, 3],
    });
  });

  it('applies loop, bounce, and once boundaries to explicit stepping', () => {
    const trajectory = createMockTrajectory(5, 2);
    getStoreState().setFile({ name: 'steps.xyz', size: 1, trajectory });

    setStoreState({ loopMode: 'loop', frame: 4 });
    getStoreState().nextFrame();
    expect(getStoreState().frame).toBe(0);
    getStoreState().prevFrame();
    expect(getStoreState().frame).toBe(4);

    setStoreState({ loopMode: 'bounce', frame: 4, playing: true });
    getStoreState().nextFrame();
    expect(getStoreState().frame).toBe(3);
    expect(getStoreState().playing).toBe(true);
    setStoreState({ frame: 0 });
    getStoreState().prevFrame();
    expect(getStoreState().frame).toBe(1);

    setStoreState({ loopMode: 'once', frame: 4, playing: true });
    getStoreState().nextFrame();
    expect(getStoreState().frame).toBe(4);
    expect(getStoreState().playing).toBe(false);
    setStoreState({ frame: 0 });
    getStoreState().prevFrame();
    expect(getStoreState().frame).toBe(0);
  });

  it('pins zero/one-frame stepping to frame zero', () => {
    const oneFrame = createMockTrajectory(1, 2);
    getStoreState().setFile({ name: 'single.xyz', size: 1, trajectory: oneFrame });
    setStoreState({ loopMode: 'bounce', frame: 0 });
    getStoreState().nextFrame();
    expect(getStoreState().frame).toBe(0);
    getStoreState().prevFrame();
    expect(getStoreState().frame).toBe(0);
  });
});

describe('Store — Atom Selection', () => {
  beforeEach(() => {
    resetStore();
  });

  it('toggles atom type visibility', () => {
    const s = getStoreState();
    s.toggleAtomType(1);
    expect(getStoreState().hiddenAtomTypes.has(1)).toBe(true);

    s.toggleAtomType(1);
    expect(getStoreState().hiddenAtomTypes.has(1)).toBe(false);
  });

  it('shows all atom types', () => {
    const s = getStoreState();
    s.toggleAtomType(1);
    s.toggleAtomType(2);
    s.showAllAtomTypes();
    expect(getStoreState().hiddenAtomTypes.size).toBe(0);
  });

});

describe('Store — File Loading', () => {
  beforeEach(() => {
    resetStore();
  });

  it('sets file and resets frame', () => {
    const traj = createMockTrajectory(5, 10);
    const file = { name: 'test.lmp', size: 1024, trajectory: traj, thermo: null };

    getStoreState().setFile(file);
    const s = getStoreState();

    expect(s.file?.name).toBe('test.lmp');
    expect(s.frame).toBe(0);
    expect(s.playing).toBe(false);
  });

  it('defaults fresh molecule loads to element coloring even with properties', () => {
    const traj = markChemicalTrajectory(createMockTrajectory(1, 10));
    traj.frames[0]!.properties.set('energy', new Float32Array(10));
    getStoreState().setColorProperty('energy');
    const file = { name: 'property-rich.lmp', size: 2048, trajectory: traj, thermo: null };

    getStoreState().setFile(file);
    const s = getStoreState();

    expect(s.colorScheme).toBe('element');
    expect(s.colorMode).toBe('type');
    expect(s.atomColorSource).toBe('element');
    expect(s.colorProperty).toBeNull();
  });

  it('opens small molecules with the high-contrast polished visual default', () => {
    const traj = markChemicalTrajectory(createMockTrajectory(1, 61));
    const file = { name: 'showcase.xyz', size: 4096, trajectory: traj, thermo: null };

    getStoreState().setFile(file);
    const s = getStoreState();

    expect(s.showBonds).toBe(true);
    expect(s.showCell).toBe(false);
    expect(s.showAxes).toBe(false);
    expect(s.postprocessPreset).toBe('editorial');
    expect(s.backgroundPreset).toBe('deep');
    expect(s.rimLightColor).toBe('#7de9ff');
    expect(s.surfacePolish).toBeGreaterThan(0);
    expect(s.surfaceClearcoat).toBeGreaterThan(0);
  });

  it('applies a catalog bond default before allowing shared URL state to override it', () => {
    const traj = markChemicalTrajectory(createMockTrajectory(1, 61));
    const file = { name: 'catalog-default.xyz', size: 4096, trajectory: traj, thermo: null };

    getStoreState().setFile(file, { initialShowBonds: false });
    expect(getStoreState().showBonds).toBe(false);

    getStoreState().decodeFromURL(encodeStateDelta({ bonds: 1 }));
    expect(getStoreState().showBonds).toBe(true);
  });

  it('preserves current-load streaming telemetry at file commit and clears it at the next load start', () => {
    const telemetry = { bytesTransferred: 1024, cacheHits: 2, cacheMisses: 1, cacheSize: 3 };
    const file = { name: 'streamed.glimbin', size: 4096, trajectory: createMockTrajectory(1, 61), thermo: null };

    getStoreState().setLoading(true, 0);
    getStoreState().setStreamingTelemetry(telemetry);
    getStoreState().setFile(file, { preserveStreamingTelemetry: true });
    expect(getStoreState().streamingTelemetry).toEqual(telemetry);

    getStoreState().setLoading(true, 0);
    expect(getStoreState().streamingTelemetry).toBeNull();
  });

  it('defaults opaque legacy types to colorway with inferred bonds off', () => {
    const traj = createMockTrajectory(1, 61);
    const file = { name: 'opaque.dump', size: 4096, trajectory: traj, thermo: null };

    getStoreState().setFile(file);
    const s = getStoreState();

    expect(s.colorScheme).toBe('colorway');
    expect(s.atomColorSource).toBe('colormap');
    expect(s.showBonds).toBe(false);
  });

  it('disables effects for massive systems', () => {
    const traj = createMockTrajectory(1, 100000); // 100K atoms
    const file = { name: 'big.lmp', size: 9999999, trajectory: traj, thermo: null };

    getStoreState().setFile(file);
    const s = getStoreState();

    expect(s.ssao).toBe(false);
    expect(s.bloom).toBe(false);
    expect(s.dof).toBe(false);
  });
});
