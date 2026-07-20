import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithStore, resetStore, getStoreState } from './test-utils';
import { McpViewerBridge, type LupiMcpDriver } from './mcpViewerBridge';
import { useStore } from './store';
import {
  MCP_ERROR_EVENT,
  MCP_REQUEST_EVENT,
  MCP_SUCCESS_EVENT,
} from './mcp/protocol';

describe('MCP viewer bridge', () => {
  beforeEach(() => {
    resetStore();
    window.history.replaceState({}, '', '/');
    delete (window as Window & { __lupiViewerMcp?: LupiMcpDriver }).__lupiViewerMcp;
    delete (window as Window & { __lupiViewerMcpReady?: unknown }).__lupiViewerMcpReady;
  });

  function mountBridge(): LupiMcpDriver {
    renderWithStore(<McpViewerBridge />);
    const driver = (window as Window & { __lupiViewerMcp?: LupiMcpDriver }).__lupiViewerMcp;
    if (!driver) throw new Error('MCP bridge driver was not mounted');
    return driver;
  }

  async function loadBenzene(driver: LupiMcpDriver) {
    const response = await driver.execute({
      id: 'test-load-benzene',
      tool: 'lupi.generate_molecule',
      arguments: { inputType: 'template', input: 'Benzene', viewer: { showBonds: true } },
    });
    expect(response.ok).toBe(true);
    expect(getStoreState().file).toBeTruthy();
  }

  it('mounts the driver and exposes tools', () => {
    const driver = mountBridge();
    expect(driver.ready).toBe(true);
    expect(driver.version).toBeTruthy();
    expect(typeof driver.execute).toBe('function');
    expect(typeof driver.executeBatch).toBe('function');
    expect(typeof driver.parseCommand).toBe('function');
    expect(typeof driver.state).toBe('function');
    expect(driver.tools().some((t) => t.name === 'lupi.set_frame')).toBe(true);
    expect(driver.tools().some((t) => t.name === 'lupi.generate_molecule')).toBe(true);
    expect(driver.tools().some((t) => t.name === 'lupi.export_asset')).toBe(true);
  });

  it('generates a molecule through the legacy tool path', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    expect(getStoreState().showBonds).toBe(true);
    expect(getStoreState().file?.trajectory.frames[0]).toMatchObject({
      identity: { kind: 'synthetic-row', unique: true },
      typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
      distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
    });
  });

  it('marks manual XYZ coordinates as atomic-number data using the XYZ format convention', async () => {
    const driver = mountBridge();
    const response = await driver.execute({
      id: 'manual-xyz',
      tool: 'lupi.generate_molecule',
      arguments: {
        inputType: 'xyz',
        input: '2\nmanual\nC 0 0 0\nO 1.2 0 0',
      },
    });

    expect(response.ok).toBe(true);
    expect(getStoreState().file?.trajectory.frames[0]).toMatchObject({
      typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
      distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    });
  });

  it('marks procedural lattices with procedural element and Ångström provenance', async () => {
    const driver = mountBridge();
    const response = await driver.execute({
      id: 'procedural-cu',
      tool: 'lupi.generate_molecule',
      arguments: { inputType: 'procedural', atomCount: 8, elements: ['Cu'], lattice: 'fcc' },
    });

    expect(response.ok).toBe(true);
    expect(getStoreState().file?.trajectory.frames[0]).toMatchObject({
      typeSemantics: { kind: 'atomic-number', provenance: 'procedural-symbol' },
      distanceSemantics: { kind: 'angstrom', provenance: 'procedural' },
    });
  });

  it('fails XYZ export actionably for opaque types while preserving model-export guidance', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    const frame = getStoreState().file!.trajectory.frames[0]!;
    frame.typeSemantics = { kind: 'opaque', provenance: 'legacy-unknown' };

    const response = await driver.execute({ id: 'opaque-xyz', tool: 'lupi.export_xyz', arguments: {} });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/complete element mapping/i);
    expect(response.error?.message).toMatch(/GLB\/USDZ/);
  });

  it('exports XYZ when every raw type has known element semantics', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const response = await driver.execute({ id: 'benzene-xyz', tool: 'lupi.export_xyz', arguments: {} });

    expect(response.ok).toBe(true);
    expect(response.result?.export?.contents).toMatch(/^12\nBenzene\n/m);
  });

  it('reports scientific semantics and effective bond topology', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    expect(driver.state()).toMatchObject({
      bondTopology: 'inferred',
      showBonds: true,
      showBondsEffective: true,
      typeSemantics: { kind: 'atomic-number', provenance: 'source-element-symbol' },
      distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
    });
    expect(driver.status()).toMatchObject({ bondTopology: 'inferred', showBondsEffective: true });
  });

  it('declines impossible bond and element settings instead of reporting requested-only state', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    const frame = getStoreState().file!.trajectory.frames[0]!;
    frame.typeSemantics = { kind: 'opaque', provenance: 'lammps-type-id' };
    frame.distanceSemantics = { kind: 'unknown', provenance: 'lammps-dump' };
    useStore.setState({ showBonds: false });

    const bonds = await driver.execute({
      id: 'impossible-bonds',
      tool: 'lupi.set_viewer',
      arguments: { showBonds: true },
    });
    const elements = await driver.execute({
      id: 'impossible-elements',
      tool: 'lupi.set_viewer',
      arguments: { colorScheme: 'element' },
    });

    expect(bonds.ok).toBe(false);
    expect(bonds.error?.message).toMatch(/requires complete element identity/i);
    expect(elements.ok).toBe(false);
    expect(elements.error?.message).toMatch(/complete element mapping/i);
    expect(driver.state()).toMatchObject({
      bondTopology: 'unavailable',
      showBonds: false,
      showBondsEffective: false,
    });
  });

  it('refuses to promote unknown source distances to angstroms through XYZ', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    const frame = getStoreState().file!.trajectory.frames[0]!;
    frame.distanceSemantics = { kind: 'unknown', provenance: 'lammps-dump' };

    const response = await driver.execute({ id: 'unknown-unit-xyz', tool: 'lupi.export_xyz', arguments: {} });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/known to be in angstroms/i);
    expect(response.error?.message).toMatch(/GLB\/USDZ/);
  });

  it('rejects transparent JPEG before creating a browser export request', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const response = await driver.execute({
      id: 'transparent-jpeg',
      tool: 'lupi.export_asset',
      arguments: { format: 'jpeg', transparent: true, width: 256, height: 256, timeoutMs: 1000 },
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/JPEG export does not support transparent output/);
    expect(getStoreState().exportRequest.type).toBeNull();
  });

  it('rejects unsnapshotable raster bonds without mutating fit or atom scale', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    const before = getStoreState();
    const beforePosition = [...before.cameraPosition];
    const beforeTarget = [...before.cameraTarget];
    const beforeScale = before.atomScale;

    const response = await driver.execute({
      id: 'bonds-raster-no-side-effects',
      tool: 'lupi.export_asset',
      arguments: { format: 'png', width: 256, height: 256, timeoutMs: 1000 },
    });

    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/Hide bonds before deterministic raster export/);
    expect(getStoreState().cameraPosition).toEqual(beforePosition);
    expect(getStoreState().cameraTarget).toEqual(beforeTarget);
    expect(getStoreState().atomScale).toBe(beforeScale);
    expect(getStoreState().exportRequest.type).toBeNull();
  });

  it('parses molecule asset requests into load plus export steps', () => {
    const driver = mountBridge();
    const requests = driver.parseCommand('render caffeine png 512x384 with bonds on camera iso');
    expect(requests).toHaveLength(2);
    expect(requests[0].tool).toBe('lupi.generate_molecule');
    expect(requests[0].arguments.viewer).toMatchObject({ showBonds: true, cameraPreset: 'iso' });
    expect(requests[1].tool).toBe('lupi.export_asset');
    expect(requests[1].arguments).toMatchObject({ format: 'png', width: 512, height: 384 });
  });

  it('does not auto-execute production-shaped URL commands, but permits explicit execution', async () => {
    const command = JSON.stringify({
      id: 'url-caffeine',
      tool: 'lupi.generate_molecule',
      arguments: { inputType: 'template', input: 'Caffeine' },
    });
    window.history.replaceState({}, '', `/?mcpCommand=${encodeURIComponent(command)}#/mcp`);
    const driver = mountBridge();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getStoreState().file).toBeNull();

    const requests = driver.parseCommand(command);
    const responses = await driver.executeBatch(requests);
    expect(responses[0].ok).toBe(true);
    expect(getStoreState().file?.name).toMatch(/caffeine/i);
  });

  it('enforces the remote URL policy again in the MCP handler before any fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const driver = mountBridge();
      const response = await driver.execute({
        id: 'unsafe-url',
        tool: 'lupi.load_molecule_url',
        arguments: { url: 'https://169.254.169.254/latest/meta-data.xyz' },
      });
      expect(response.ok).toBe(false);
      expect(response.error?.message).toMatch(/not allowed/i);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('parses only allowlisted remote molecule URLs into MCP load requests', () => {
    const driver = mountBridge();
    expect(driver.parseCommand('https://lupi.live/gallery/curated/caffeine.xyz')[0]).toMatchObject({
      tool: 'lupi.load_molecule_url',
      arguments: { url: 'https://lupi.live/gallery/curated/caffeine.xyz' },
    });
    expect(() => driver.parseCommand('https://lupi.live.evil.example/gallery/caffeine.xyz')).toThrow(/not allowed/i);
  });

  it('lists new AI-control tools', () => {
    const driver = mountBridge();
    const names = driver.tools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'lupi.generate_molecule',
      'lupi.export_asset',
      'lupi.set_frame',
      'lupi.play',
      'lupi.pause',
      'lupi.set_playback_speed',
      'lupi.set_camera_preset',
      'lupi.set_camera',
      'lupi.fit_camera',
      'lupi.set_background',
      'lupi.set_postprocess',
      'lupi.set_material',
      'lupi.set_lighting',
      'lupi.set_filter_shell',
      'lupi.set_vector_field',
      'lupi.set_atom_visibility',
      'lupi.add_annotation',
      'lupi.remove_annotation',
      'lupi.encode_view_url',
      'lupi.reset_viewer',
    ]));
  });

  it('dispatches new tools through the command bus', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const state0 = driver.state();
    expect(state0.frame).toBe(0);

    const setFrameResponse = await driver.execute({
      id: 'test-set-frame',
      tool: 'lupi.set_frame',
      arguments: { frame: 7 },
    });
    expect(setFrameResponse.ok).toBe(true);
    expect(setFrameResponse.result?.frame).toBe(0);
  });

  it('toggles playback through play/pause tools', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const playResponse = await driver.execute({ id: 'test-play', tool: 'lupi.play', arguments: {} });
    expect(playResponse.ok).toBe(true);
    expect(getStoreState().playing).toBe(true);

    const pauseResponse = await driver.execute({ id: 'test-pause', tool: 'lupi.pause', arguments: {} });
    expect(pauseResponse.ok).toBe(true);
    expect(getStoreState().playing).toBe(false);
  });

  it('sets playback speed with clamping', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const response = await driver.execute({
      id: 'test-speed',
      tool: 'lupi.set_playback_speed',
      arguments: { speed: 32 },
    });
    expect(response.ok).toBe(true);
    expect(getStoreState().playbackSpeed).toBe(16);
  });

  it('sets camera preset and direct camera state', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const presetResponse = await driver.execute({
      id: 'test-cam-preset',
      tool: 'lupi.set_camera_preset',
      arguments: { preset: 'top' },
    });
    expect(presetResponse.ok).toBe(true);

    const stateResponse = await driver.execute({
      id: 'test-cam-state',
      tool: 'lupi.set_camera',
      arguments: { position: [0, 0, 10], target: [0, 0, 0], fov: 45 },
    });
    expect(stateResponse.ok).toBe(true);
    expect(getStoreState().cameraFov).toBe(45);
  });

  it('fits camera to molecule', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    const fitSpy = vi.spyOn(getStoreState(), 'fitCameraView');

    const response = await driver.execute({ id: 'test-fit', tool: 'lupi.fit_camera', arguments: {} });
    expect(response.ok).toBe(true);
    expect(fitSpy).toHaveBeenCalled();
    fitSpy.mockRestore();
  });

  it('controls background, postprocess, and material', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const bgResponse = await driver.execute({
      id: 'test-bg',
      tool: 'lupi.set_background',
      arguments: { preset: 'slate', opacity: 0.8 },
    });
    expect(bgResponse.ok).toBe(true);
    expect(getStoreState().backgroundPreset).toBe('slate');

    const ppResponse = await driver.execute({
      id: 'test-pp',
      tool: 'lupi.set_postprocess',
      arguments: { preset: 'diagram', intensity: 0.5 },
    });
    expect(ppResponse.ok).toBe(true);
    expect(getStoreState().postprocessPreset).toBe('diagram');

    const matResponse = await driver.execute({
      id: 'test-mat',
      tool: 'lupi.set_material',
      arguments: { scene: 'forge', intensity: 1.2 },
    });
    expect(matResponse.ok).toBe(true);
    expect(getStoreState().materialScene).toBe('forge');
  });

  it('controls lighting', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const response = await driver.execute({
      id: 'test-light',
      tool: 'lupi.set_lighting',
      arguments: { ambient: 0.5, dir: 0.8, rim: 1.1 },
    });
    expect(response.ok).toBe(true);
    expect(getStoreState().ambientLightIntensity).toBe(0.5);
    expect(getStoreState().dirLightIntensity).toBe(0.8);
    expect(getStoreState().rimLightIntensity).toBe(1.1);
  });

  it('controls filter shell and vector field', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const shellResponse = await driver.execute({
      id: 'test-shell',
      tool: 'lupi.set_filter_shell',
      arguments: { shape: 'sphere', preset: 'cryo', opacity: 0.4, radius: 2 },
    });
    expect(shellResponse.ok).toBe(true);
    expect(getStoreState().filterShellShape).toBe('sphere');

    const vfResponse = await driver.execute({
      id: 'test-vf',
      tool: 'lupi.set_vector_field',
      arguments: { fieldId: 'velocity', scale: 1.5, density: 0.5 },
    });
    expect(vfResponse.ok).toBe(true);
    expect(getStoreState().vectorField).toBe('velocity');
  });

  it('toggles atom type visibility and scales', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const response = await driver.execute({
      id: 'test-visibility',
      tool: 'lupi.set_atom_visibility',
      arguments: { hiddenAtomTypes: [1], atomTypeScales: { 6: 1.5 } },
    });
    expect(response.ok).toBe(true);
    expect(getStoreState().hiddenAtomTypes.has(1)).toBe(true);
    expect(getStoreState().atomTypeScales[6]).toBe(1.5);
  });

  it('adds and removes annotations', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const addResponse = await driver.execute({
      id: 'test-annotation-add',
      tool: 'lupi.add_annotation',
      arguments: { atomIndex: 0, text: 'Test label' },
    });
    expect(addResponse.ok).toBe(true);
    const annotations = getStoreState().annotations;
    expect(annotations.length).toBe(1);

    const removeResponse = await driver.execute({
      id: 'test-annotation-remove',
      tool: 'lupi.remove_annotation',
      arguments: { id: annotations[0].id },
    });
    expect(removeResponse.ok).toBe(true);
    expect(getStoreState().annotations.length).toBe(0);
  });

  it('encodes the current view to a URL', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const response = await driver.execute({ id: 'test-encode', tool: 'lupi.encode_view_url', arguments: {} });
    expect(response.ok).toBe(true);
    expect(typeof response.result?.url).toBe('string');
    expect(response.result?.url).toMatch(/^https?:\/\/.*\?s=/);
  });

  it('emits lifecycle CustomEvents on the command bus', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);

    const requestListener = vi.fn();
    const successListener = vi.fn();
    const errorListener = vi.fn();
    window.addEventListener(MCP_REQUEST_EVENT, requestListener);
    window.addEventListener(MCP_SUCCESS_EVENT, successListener);
    window.addEventListener(MCP_ERROR_EVENT, errorListener);

    try {
      await driver.execute({
        id: 'test-event',
        tool: 'lupi.set_background',
        arguments: { preset: 'blueprint' },
      });
      expect(requestListener).toHaveBeenCalled();
      expect(successListener).toHaveBeenCalled();
      expect(errorListener).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(MCP_REQUEST_EVENT, requestListener);
      window.removeEventListener(MCP_SUCCESS_EVENT, successListener);
      window.removeEventListener(MCP_ERROR_EVENT, errorListener);
    }
  });

  it('returns an error response for unsupported tools', async () => {
    const driver = mountBridge();
    const response = await driver.execute({
      id: 'test-unknown',
      tool: 'lupi.not_a_real_tool',
      arguments: {},
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/Unsupported/);
  });

  it('returns an error response for invalid new tool arguments', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    const response = await driver.execute({
      id: 'test-invalid',
      tool: 'lupi.set_frame',
      arguments: {},
    });
    expect(response.ok).toBe(false);
    expect(response.error?.message).toMatch(/requires.*frame/);
  });

  it('resets the viewer through the reset tool', async () => {
    const driver = mountBridge();
    await loadBenzene(driver);
    getStoreState().toggleBonds();

    const response = await driver.execute({ id: 'test-reset', tool: 'lupi.reset_viewer', arguments: {} });
    expect(response.ok).toBe(true);
    expect(getStoreState().file).toBeNull();
  });
});
