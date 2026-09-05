import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshPhysicalNodeMaterial,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SphereGeometry,
  Vector3,
  WebGPURenderer,
} from 'three/webgpu';
import type { Node, RenderTarget } from 'three/webgpu';
import { color, positionLocal, uniform } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { tslExports } from 'vgpu/three';
import atomModule from './atom-surface.wgsl';
import type { StudioLook, StudioSnapshot } from './snapshot';

type SurfaceExports = {
  atomSurface: { position: Node; baseColor: Node; contour: Node; emphasis: Node };
};
const { atomSurface } = tslExports<SurfaceExports>(atomModule)('atomSurface');

export interface StudioRuntime {
  setLook: (look: StudioLook) => void;
  setSpin: (spin: boolean) => void;
  setLight: (degrees: number) => void;
  setFocus: (groupIndex: number | null) => void;
  reset: () => void;
  dispose: () => void;
}

/** A separate, opt-in renderer. No store writes, external assets, or network rendering. */
export async function createStudio(
  host: HTMLElement,
  snapshot: StudioSnapshot,
  signal: AbortSignal,
  onFailure: (message: string) => void,
): Promise<StudioRuntime> {
  let device: GPUDevice | undefined;
  let renderer: WebGPURenderer | undefined;
  let controls: OrbitControls | undefined;
  let observer: ResizeObserver | undefined;
  let environmentMap: RenderTarget | undefined;
  let pendingFrame = 0;
  let disposed = false;
  let initialized = false;
  let ready = false;
  const geometry = new SphereGeometry(1, 32, 24);
  const materials: MeshPhysicalNodeMaterial[] = [];
  const meshes: InstancedMesh[] = [];
  const focusSetters: Array<(emphasized: boolean) => void> = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(pendingFrame);
    observer?.disconnect();
    document.removeEventListener('visibilitychange', requestDraw);
    signal.removeEventListener('abort', dispose);
    controls?.dispose();
    meshes.forEach(mesh => mesh.dispose());
    materials.forEach(material => material.dispose());
    geometry.dispose();
    environmentMap?.dispose();
    if (initialized) renderer?.dispose();
    renderer?.domElement.remove();
    device?.destroy();
  };
  const fail = (message: string) => {
    if (disposed) return;
    dispose();
    onFailure(message);
  };
  const checkCanceled = () => {
    if (signal.aborted || disposed) throw new Error('Studio closed.');
  };
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.01, 1000);
  const contour = uniform(0);
  let spinning = false;
  let previousTime = 0;
  function requestDraw() {
    if (ready && !disposed && !pendingFrame && !document.hidden)
      pendingFrame = requestAnimationFrame(draw);
  }
  function draw(now: number) {
    pendingFrame = 0;
    if (disposed || document.hidden) return;
    try {
      if (spinning) controls?.update(Math.min((now - previousTime) / 1000, 0.05));
      previousTime = now;
      renderer!.render(scene, camera);
      if (spinning) requestDraw();
    } catch {
      fail('The GPU preview stopped. Return to the viewer; your molecule is unchanged.');
    }
  }
  try {
    checkCanceled();
    const adapter = await navigator.gpu?.requestAdapter({
      powerPreference: 'high-performance',
    });
    checkCanceled();
    if (!adapter)
      throw new Error(
        'WebGPU is unavailable in this browser or on this device. The regular viewer still works.',
      );
    device = await adapter.requestDevice({ label: 'Lupi GPU Studio' });
    checkCanceled();
    renderer = new WebGPURenderer({ device, alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.setClearColor(0x000000, 0);
    await renderer.init();
    initialized = true;
    checkCanceled();
    if (!('isWebGPUBackend' in renderer.backend))
      throw new Error(
        'This browser could not start WebGPU. The regular viewer is still available.',
      );
    renderer.onDeviceLost = () =>
      fail('The WebGPU connection was lost. Return to the viewer and reopen Studio to try again.');
    device.addEventListener('uncapturederror', () =>
      fail('This device could not render the studio effect. Your regular viewer is unchanged.'),
    );
    renderer.domElement.setAttribute(
      'aria-label',
      `${snapshot.name}, GPU Studio molecular preview`,
    );
    renderer.domElement.setAttribute('role', 'img');
    host.appendChild(renderer.domElement);

    // A small local softbox environment: no HDR download or per-frame generation.
    const room = new RoomEnvironment();
    const pmrem = new PMREMGenerator(renderer);
    try {
      environmentMap = pmrem.fromScene(room, 0.06, 0.1, 100, { size: 128 });
      scene.environment = environmentMap.texture;
      scene.environmentIntensity = 0.65;
    } finally {
      room.dispose();
      pmrem.dispose();
    }

    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const group of snapshot.groups) {
      for (let i = 0; i < group.positions.length; i += 3) {
        const p = new Vector3(...(group.positions.slice(i, i + 3) as [number, number, number]));
        min.min(p.clone().addScalar(-group.radius * 2.2));
        max.max(p.clone().addScalar(group.radius * 2.2));
      }
    }
    const center = min.clone().add(max).multiplyScalar(0.5);
    let radius = 0.5;
    for (const group of snapshot.groups) {
      for (let i = 0; i < group.positions.length; i += 3) {
        radius = Math.max(
          radius,
          Math.hypot(
            group.positions[i] - center.x,
            group.positions[i + 1] - center.y,
            group.positions[i + 2] - center.z,
          ) +
            group.radius * 2.2,
        );
      }
    }
    const molecule = new Group();
    const matrix = new Matrix4();
    for (const group of snapshot.groups) {
      const material = new MeshPhysicalNodeMaterial({
        roughness: 0.32,
        metalness: 0.08,
        clearcoat: 0.35,
        clearcoatRoughness: 0.24,
      });
      const emphasis = uniform(1);
      material.colorNode = atomSurface({
        position: positionLocal,
        baseColor: color(new Color(group.color)),
        contour,
        emphasis,
      });
      focusSetters.push(emphasized => {
        emphasis.value = emphasized ? 1 : 0.08;
        material.envMapIntensity = emphasized ? 1 : 0.15;
        material.roughness = emphasized ? 0.32 : 0.85;
        material.clearcoat = emphasized ? 0.35 : 0;
      });
      materials.push(material);
      const mesh = new InstancedMesh(geometry, material, group.positions.length / 3);
      meshes.push(mesh);
      for (let i = 0; i < mesh.count; i++) {
        const r = group.radius * 2.2;
        matrix.makeScale(r, r, r);
        matrix.setPosition(
          group.positions[i * 3] - center.x,
          group.positions[i * 3 + 1] - center.y,
          group.positions[i * 3 + 2] - center.z,
        );
        mesh.setMatrixAt(i, matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
      molecule.add(mesh);
    }
    scene.add(molecule, new HemisphereLight(0xd8f5e8, 0x252b38, 0.65));
    const key = new DirectionalLight(0xffe2ba, 2.4);
    const rim = new DirectionalLight(0xbbe8df, 2);
    rim.position.set(4, 1, -2);
    const fill = new DirectionalLight(0xb8c8eb, 0.8);
    fill.position.set(1, -2, 4);
    scene.add(key, rim, fill);
    const setLight = (degrees: number) => {
      const angle = (Math.max(-180, Math.min(180, degrees)) * Math.PI) / 180;
      key.position.set(Math.sin(angle) * 5, 3, Math.cos(angle) * 5);
      scene.environmentRotation.y = angle;
      requestDraw();
    };
    setLight(-35);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = radius * 1.2;
    controls.maxDistance = radius * 12;
    controls.autoRotateSpeed = 0.65;
    const fitDistance = () => {
      const fov = Math.min(
        (camera.fov * Math.PI) / 180,
        2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect),
      );
      return (radius / Math.sin(fov / 2)) * 1.04;
    };
    const reset = () => {
      const distance = fitDistance();
      camera.position.set(0.25, 0.16, 1).normalize().multiplyScalar(distance);
      camera.near = radius / 100;
      camera.far = Math.max(radius * 50, distance * 4);
      camera.updateProjectionMatrix();
      controls!.target.set(0, 0, 0);
      controls!.update();
      requestDraw();
    };
    const resize = () => {
      const previousFit = fitDistance();
      const { width, height } = host.getBoundingClientRect();
      renderer!.setSize(Math.max(width, 1), Math.max(height, 1));
      camera.aspect = Math.max(width, 1) / Math.max(height, 1);
      // Keep the learner's angle and relative zoom when the viewport changes.
      camera.position.multiplyScalar(fitDistance() / previousFit);
      camera.updateProjectionMatrix();
      requestDraw();
    };
    resize();
    reset();
    // Compile and submit a real frame before presenting a ready indicator.
    device.pushErrorScope('validation');
    await renderer.compileAsync(scene, camera);
    checkCanceled();
    renderer.render(scene, camera);
    const validationError = await device.popErrorScope();
    if (validationError)
      throw new Error(
        'The studio shader is not supported by this device. The regular viewer is still available.',
      );
    checkCanceled();
    observer = new ResizeObserver(resize);
    observer.observe(host);
    controls.addEventListener('change', requestDraw);
    document.addEventListener('visibilitychange', requestDraw);
    signal.addEventListener('abort', dispose, { once: true });
    ready = true;
    return {
      setLook(look) {
        contour.value = look === 'contours' ? 1 : 0;
        requestDraw();
      },
      setSpin(spin) {
        spinning = spin;
        controls!.autoRotate = spin;
        previousTime = performance.now();
        requestDraw();
      },
      setLight,
      setFocus(groupIndex) {
        focusSetters.forEach((setEmphasis, index) =>
          setEmphasis(groupIndex === null || groupIndex === index),
        );
        requestDraw();
      },
      reset,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
