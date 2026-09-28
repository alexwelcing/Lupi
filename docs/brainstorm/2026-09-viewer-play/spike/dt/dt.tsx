import { Component, type ReactNode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame, useThree, getScheduler } from '@react-three/fiber/webgpu';
import { OrbitControls, Html, Billboard, Line, ContactShadows, MeshTransmissionMaterial } from '@react-three/drei/webgpu';
import * as THREE from 'three/webgpu';
import { useRenderPipeline } from '@react-three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { vignette } from 'three/addons/tsl/display/CRT.js';
import { renderOutput, vec3, vec4, uniform } from 'three/tsl';

// G6 shim (headless Chromium 141 only).
const GT = (globalThis as any).GPUTexture;
if (GT) { const o = GT.prototype.createView; GT.prototype.createView = function (d?: any) { if (d && typeof d.swizzle === 'string') { const c: any = {}; for (const k of Object.keys(d)) if (k !== 'swizzle' && d[k] !== undefined) c[k] = d[k]; return o.call(this, c); } return o.call(this, d); }; }

const q = new URLSearchParams(location.search);
const no = new Set((q.get('no') ?? '').split(','));
const out: any = { ready: false, frames: 0, order: [] as string[], orderSamples: [] as string[][], errors: [], caught: null, renderCalls: 0 };
(window as any).__dt = out;

const sched = getScheduler();
try {
  sched.addPhase('lupi-canonical', { after: 'update' });
  sched.addPhase('lupi-uniforms', { after: 'lupi-canonical' });
  sched.addPhase('lupi-capture', { after: 'render' });
  out.phasesAdded = true;
} catch (e) { out.phasesAdded = String(e); }

const factory = async (defaults: any) => {
  if (q.get('fail') === '1') throw new Error('LupiRendererUnavailable: no WebGPU adapter and no WebGL2 context');
  const base = { ...defaults, canvas: defaults.canvas as HTMLCanvasElement, antialias: false, alpha: true };
  if (q.get('backend') === 'webgl') return new THREE.WebGPURenderer({ ...base, forceWebGL: true });
  const adapter = await (navigator as any).gpu?.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) return new THREE.WebGPURenderer({ ...base, forceWebGL: true });
  const requiredLimits = { maxBufferSize: adapter.limits.maxBufferSize, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize };
  return new THREE.WebGPURenderer({ ...base, requiredLimits });   // three creates the device (all features)
};

function labelTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d')!;
  x.font = 'bold 84px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 14; x.strokeStyle = '#000'; x.strokeText(text, 128, 64);
  x.fillStyle = '#ffffff'; x.fillText(text, 128, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function Probe({ name, p }: { name: string; p: [number, number, number] }) {
  const camera = useThree((s) => s.camera); const size = useThree((s) => s.size);
  useFrame(() => {
    const v = new THREE.Vector3(...p).project(camera);
    (out.probes ??= {})[name] = [Math.round((v.x * 0.5 + 0.5) * size.width), Math.round((-v.y * 0.5 + 0.5) * size.height)];
  });
  return null;
}

function Scene() {
  const tex = useMemo(() => labelTexture('C12'), []);
  const renderer = useThree((s: any) => s.renderer);
  useEffect(() => {
    out.backend = renderer?.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2';
    const orig = renderer.render.bind(renderer);
    renderer.render = (...a: any[]) => { out.renderCalls++; if (out.frames > 5 && out.frames < 9) out.order.push('RENDER'); return orig(...a); };
  }, [renderer]);
  const mark = (tag: string) => () => { if (out.frames > 5 && out.frames < 9) out.order.push(tag); };
  useFrame(mark('update'));
  useFrame(mark('lupi-canonical'), { phase: 'lupi-canonical', id: 'lupi/export-canonical' });
  useFrame(mark('lupi-uniforms'), { phase: 'lupi-uniforms', id: 'lupi/atoms-uniforms' });
  useFrame(mark('lupi-capture'), { phase: 'lupi-capture', id: 'lupi/export-capture' });
  useFrame(mark('finish'), { phase: 'finish' });
  useFrame((s: any) => {
    out.frames++;
    if (out.frames === 1) { out.hasElapsed = typeof s.elapsed === 'number'; out.hasClock = 'clock' in s && s.clock !== undefined; }
    if (out.frames === 40) out.ready = true;
  }, { phase: 'start' });
  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={2} />
      <mesh position={[-1.2, 0.5, 0]}><sphereGeometry args={[0.5, 48, 32]} /><meshStandardMaterial color="#d03030" roughness={0.4} /></mesh>
      <mesh position={[1.2, 0.5, 0]}><sphereGeometry args={[0.5, 48, 32]} />{no.has('mtm') ? <meshStandardMaterial color="#80c0ff" /> : <MeshTransmissionMaterial transmission={1} thickness={0.5} roughness={0.1} color="#80c0ff" />}</mesh>
      <mesh position={[1.2, 0.5, -1.2]}><boxGeometry args={[0.6, 0.6, 0.6]} /><meshStandardMaterial color="#20a040" /></mesh>
      {!no.has('contact') && <ContactShadows position={[0, 0, 0]} scale={8} opacity={1} blur={1.5} far={2} resolution={256} />}
      <Line points={[[-2, 1.8, 0], [2, 1.8, 0]]} color="#d5ef9c" lineWidth={4} />
      <Billboard position={[0, 1.15, 0]}><mesh><planeGeometry args={[0.8, 0.4]} /><meshBasicMaterial map={tex} transparent depthWrite={false} /></mesh></Billboard>
      {!no.has('html') && <Html position={[0, -0.6, 0]} center><div id="html-label" style={{ font: '12px sans-serif', background: '#000', color: '#fff', padding: 2 }}>HTML</div></Html>}
      {!no.has('orbit') && <OrbitControls makeDefault />}
      {q.get('post') === '1' && <Post />}
      <Probe name="sphereA" p={[-1.2, 0.5, 0.49]} />
      <Probe name="sphereB" p={[1.2, 0.5, 0.49]} />
      <Probe name="line" p={[0, 1.8, 0]} />
      <Probe name="label" p={[0, 1.15, 0]} />
      <Probe name="shadowA" p={[-1.2, 0.0, 0.0]} />
      <Probe name="floorFar" p={[-3.2, 0.0, 1.5]} />
    </>
  );
}

function GlCompat({ children }: { children: ReactNode }) {
  // drei 11.0.0-alpha.7 still reads state.gl (Html, ContactShadows, MTM, controls). In fiber canary.14007b4
  // WebGPU mode, zustand's first set() snapshots the deprecated gl getter as null. Re-point it at the renderer
  // before any drei child renders.
  const gl = useThree((s: any) => s.gl);
  const renderer = useThree((s: any) => s.renderer);
  const set = useThree((s: any) => s.set);
  useEffect(() => { if (!gl && renderer) set({ gl: renderer }); }, [gl, renderer, set]);
  out.glCompat = gl ? 'set' : 'pending';
  return gl ? <>{children}</> : null;
}

function Post() {
  useRenderPipeline((st: any) => {
    const { renderPipeline, passes, camera } = st;
    const sp = passes.scenePass;
    const color = sp.getTextureNode('output');
    const depth = sp.getTextureNode('depth');
    const aoPass = ao(depth, null, camera); (aoPass as any).resolutionScale = 0.5;
    const aoed = color.mul(vec4(vec3(aoPass.getTextureNode().r), 1));
    const withBloom = aoed.add(bloom(aoed, 0.6, 0.3, 0.8));
    const d = dof(withBloom, sp.getViewZNode(), uniform(5), uniform(2), uniform(1));
    const toned = renderOutput(d, THREE.ACESFilmicToneMapping, THREE.SRGBColorSpace);
    renderPipeline.outputColorTransform = false;
    renderPipeline.outputNode = vec4(vignette(toned.rgb, 0.4, 0.5), toned.a);
    out.post = 'installed';
  });
  return null;
}

class Boundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { err: String(e) }; }
  componentDidCatch(e: unknown) { out.caught = String(e); out.ready = true; }
  render() { return this.state.err ? <div id="fallback">Fallback: {this.state.err}</div> : this.props.children; }
}

createRoot(document.getElementById('root')!).render(
  <Boundary>
    <Canvas renderer={factory} camera={{ position: [0, 1.6, 5], fov: 50 }} dpr={1} background="#d8d8d8"
      onCreated={(s: any) => { s.renderer.toneMapping = THREE.NoToneMapping; out.glAtCreated = s.gl === s.renderer ? 'renderer' : String(s.gl); if (q.get('glshim') === '1') s.set({ gl: s.renderer }); out.created = true; }}>
      {q.get('gate') === '1' ? <GlCompat><Scene /></GlCompat> : <Scene />}
    </Canvas>
  </Boundary>,
);
window.addEventListener('error', (e) => out.errors.push('win:' + String(e.message)));
window.addEventListener('unhandledrejection', (e: any) => out.errors.push('rej:' + String(e.reason)));
