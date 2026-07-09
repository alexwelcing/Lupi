import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithStore, resetStore, getStoreState } from './test-utils';
import { McpViewerBridge, type LupiMcpDriver } from './mcpViewerBridge';
import {
  MCP_ERROR_EVENT,
  MCP_REQUEST_EVENT,
  MCP_SUCCESS_EVENT,
} from './mcp/protocol';

describe('MCP viewer bridge', () => {
  beforeEach(() => {
    resetStore();
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
