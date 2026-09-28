import { swizzleShimActive } from './swizzleShim';
import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { positionView, vec3, vec4 } from 'three/tsl';
import { createRendererFactory, rendererReport } from './renderer';
import { buildPalettes, createAtomImpostor } from './atomImpostor';
import { createBondImpostor } from './bondImpostor';
import { CPK, DISPLAY_RADIUS, FIXTURE, caffeine, cloud, fixtureAtoms } from './data';

// ── Query parameters (the Playwright verifier drives everything through these) ──
const q = new URLSearchParams(location.search);
const backend = (q.get('backend') ?? 'auto') as 'auto' | 'webgpu' | 'webgl';
const sceneName = q.get('scene') ?? 'caffeine'; // caffeine | cloud | fixture
const count = Number(q.get('n') ?? 100000);
const cameraKind = q.get('camera') ?? 'persp'; // persp | ortho
const isFixture = sceneName === 'fixture';
const flat = q.get('flat') === '1' || isFixture;
const writeDepth = q.get('nodepth') !== '1';
const a2c = q.get('a2c') === '1';
const antialias = q.get('aa') !== '0';
const legacy = q.get('legacy') === '1';
const animate = q.get('animate') === '1';
const progress = q.has('progress') ? Number(q.get('progress')) : isFixture ? FIXTURE.progress : 0.0;
const cull = Number(q.get('cull') ?? 0);
const readyFrames = Number(q.get('readyFrames') ?? 8);
if (q.get('bare') === '1') document.body.classList.add('bare');

interface SpikeState {
  ready: boolean;
  frames: number;
  backend?: string;
  info: Record<string, unknown>;
  errors: string[];
  shaders?: () => Promise<unknown>;
}
const spike: SpikeState = { ready: false, frames: 0, info: {}, errors: [] };
(window as unknown as { __spike: SpikeState }).__spike = spike;
window.addEventListener('error', (e) => spike.errors.push(`${(performance.now()|0)}ms f${spike.frames} ${String(e.message)}`));
window.addEventListener('unhandledrejection', (e) => spike.errors.push(`${(performance.now()|0)}ms f${spike.frames} ${String(e.reason)}`));
(window as unknown as { __factoryCalls: number }).__factoryCalls = 0;

function makeCamera(aspect: number): THREE.Camera {
  const c = isFixture
    ? FIXTURE.camera
    : sceneName === 'cloud'
      ? { position: [0, 30, 140], target: [0, 0, 0], fov: 45, near: 1, far: 500, orthoHalfHeight: 70 }
      : { position: [0, 0, 12], target: [0, 0, 0], fov: 45, near: 0.1, far: 100, orthoHalfHeight: 4.5 };
  let cam: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  if (cameraKind === 'ortho') {
    const h = c.orthoHalfHeight;
    cam = new THREE.OrthographicCamera(-h * aspect, h * aspect, h, -h, c.near, c.far);
  } else {
    cam = new THREE.PerspectiveCamera(c.fov, aspect, c.near, c.far);
  }
  cam.position.set(c.position[0], c.position[1], c.position[2]);
  cam.lookAt(c.target[0], c.target[1], c.target[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  (cam as unknown as { manual: boolean }).manual = true; // keep the exact projection (R3F must not re-derive it)
  return cam;
}

function buildScene() {
  const group = new THREE.Group();
  if (isFixture) {
    const { atoms, bonds } = fixtureAtoms();
    const pal = buildPalettes(
      (s) => (FIXTURE.slots[s]?.color ?? [0, 0, 0]) as [number, number, number],
      (s) => FIXTURE.slots[s]?.radius ?? 0,
    );
    const a = createAtomImpostor(atoms, pal, { flat, writeDepth, alphaToCoverage: a2c, legacyAttributes: legacy });
    const b = createBondImpostor(bonds, { flat, writeDepth });
    // An ordinary rasterized mesh slicing atom 0: proves impostor depth composes with real geometry depth.
    const pl = FIXTURE.plane;
    const planeGeo = new THREE.PlaneGeometry(pl.x1 - pl.x0, pl.y1 - pl.y0);
    const planeMat = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color().setRGB(0, 1, 0), side: THREE.DoubleSide });
    if (q.get('debug') === 'depth') planeMat.colorNode = vec4(vec3(positionView.z.negate().div(10.0)), 1.0);
    const plane = new THREE.Mesh(planeGeo, planeMat);
    plane.position.set((pl.x0 + pl.x1) / 2, (pl.y0 + pl.y1) / 2, pl.z);
    group.add(a.mesh, b.mesh, plane);
    return { group, atoms: a, bonds: b, count: atoms.count, bondCount: bonds.count };
  }
  const pal = buildPalettes(
    (s) => CPK[s] ?? [255, 20, 147],
    (s) => (DISPLAY_RADIUS[s] ?? 0) * (sceneName === 'cloud' ? 2.2 : 1),
    (s) => (s === 26 || s === 29 || s === 79 ? [0.85, 0.25, 0] : s === 1 ? [0, 0.35, 0.3] : [0.05, 0.45, 0]),
  );
  if (sceneName === 'cloud') {
    const atoms = cloud(count, 60);
    const a = createAtomImpostor(atoms, pal, { flat, writeDepth, alphaToCoverage: a2c, legacyAttributes: legacy });
    group.add(a.mesh);
    return { group, atoms: a, bonds: null, count: atoms.count, bondCount: 0 };
  }
  const { atoms, bonds } = caffeine();
  const a = createAtomImpostor(atoms, pal, { flat, writeDepth, alphaToCoverage: a2c, legacyAttributes: legacy });
  const b = createBondImpostor(bonds, { flat, writeDepth });
  group.add(a.mesh, b.mesh);
  // Center caffeine.
  group.position.set(-0.1, 0.1, 0);
  return { group, atoms: a, bonds: b, count: atoms.count, bondCount: bonds.count };
}

function Spike() {
  const renderer = useThree((s) => s.renderer) as unknown as THREE.WebGPURenderer;
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const webGPUSupported = useThree((s) => (s as unknown as { webGPUSupported: boolean }).webGPUSupported);
  const built = useMemo(buildScene, []);
  const setFrameloop = useThree((s) => s.setFrameloop);
  useEffect(() => {
    // Lets the verifier freeze the loop so the compositor can hand out a screenshot
    // when a single software-rendered frame takes longer than Playwright's timeout.
    (spike as unknown as { pause: () => void }).pause = () => setFrameloop('never');
  }, [setFrameloop]);

  useEffect(() => {
    built.atoms.uniforms.progress.value = progress;
    built.atoms.uniforms.cullPixelRadius.value = cull;
    if (built.bonds) built.bonds.uniforms.progress.value = 0; // fixture bonds are static
    if (sceneName === 'caffeine') built.atoms.uniforms.highlightAtom.value = q.has('highlight') ? Number(q.get('highlight')) : -1;
    const backendObj = renderer.backend as unknown as { isWebGPUBackend?: boolean; compatibilityMode?: boolean };
    spike.backend = backendObj.isWebGPUBackend ? 'webgpu' : 'webgl2';
    spike.info = {
      ...spike.info,
      rendererPath: rendererReport.path,
      requested: rendererReport.requested,
      adapterInfo: rendererReport.adapterInfo,
      limits: rendererReport.limits,
      compatibilityMode: backendObj.compatibilityMode ?? null,
      webGPUSupported,
      samples: (renderer as unknown as { samples: number }).samples,
      toneMapping: renderer.toneMapping,
      outputColorSpace: renderer.outputColorSpace,
      atoms: built.count,
      bonds: built.bondCount,
      scene: sceneName,
      camera: cameraKind,
      flat, writeDepth, a2c, antialias, legacy, progress,
      rendererFactoryError: rendererReport.error,
      swizzleShimActive,
    };
    spike.shaders = async () => {
      const dbg = (renderer as unknown as { debug: { getShaderAsync: (s: THREE.Scene, c: THREE.Camera, o: THREE.Object3D) => Promise<{ vertexShader: string; fragmentShader: string }> } }).debug;
      const out: Record<string, unknown> = {};
      for (const obj of [built.atoms.mesh, built.bonds?.mesh].filter(Boolean) as THREE.Object3D[]) {
        out[obj.name] = await dbg.getShaderAsync(scene as unknown as THREE.Scene, camera, obj);
      }
      return out;
    };
  }, [built, renderer, camera, scene, webGPUSupported]);

  useFrame((state) => {
    spike.frames += 1;
    if (animate) {
      const t = (state as unknown as { elapsed: number }).elapsed;
      built.atoms.uniforms.progress.value = 0.5 + 0.5 * Math.sin(t * 1.3);
      built.group.rotation.y = t * 0.25;
    }
    if (spike.frames === readyFrames) {
      spike.ready = true;
      spike.info.readyAtMs = Math.round(performance.now());
    }
    const hud = document.getElementById('hud');
    if (hud && (spike.frames === 8 || spike.frames % 60 === 0)) {
      hud.textContent = `backend: ${spike.backend}  (${rendererReport.path})\nscene: ${sceneName}  atoms: ${built.count}  bonds: ${built.bondCount}\ncamera: ${cameraKind}  depthNode: ${writeDepth}  a2c: ${a2c}`;
    }
  });

  return <primitive object={built.group} />;
}

function App() {
  const width = isFixture ? FIXTURE.size.width : q.has('w') ? Number(q.get('w')) : undefined;
  const height = isFixture ? FIXTURE.size.height : q.has('h') ? Number(q.get('h')) : undefined;
  const aspect = width && height ? width / height : window.innerWidth / window.innerHeight;
  const camera = useMemo(() => makeCamera(aspect), [aspect]);
  const factory = useMemo(() => createRendererFactory(backend, antialias), []);
  const bg = isFixture ? '#000000' : '#101817';
  return (
    <div style={{ width: width ?? '100vw', height: height ?? '100vh' }}>
      <Canvas
        id="spike-canvas"
        renderer={factory}
        camera={camera}
        dpr={isFixture ? 1 : Math.min(window.devicePixelRatio, 2)}
        background={bg}
        onCreated={(state) => {
          // R3F's first configure() overwrites a factory's toneMapping with ACES
          // (fiber Ch4JrXS2.mjs:14186-14188); set it here, like ViewerCanvas does today.
          const r = state.renderer as unknown as THREE.WebGPURenderer;
          spike.info.toneMappingBeforeOnCreated = r.toneMapping;
          r.toneMapping = THREE.NoToneMapping;
        }}
      >
        <Spike />
      </Canvas>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  q.get('strict') === '0' ? <App /> : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
