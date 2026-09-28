/**
 * LupiContactShadow.tsx — the soft floor shadow under a molecule
 * (plan-final §5.11).
 *
 * Replaces drei's ContactShadows, which draws nothing on the WebGPU backend
 * and a Y-flipped shadow on WebGL2 (lead probe L5). Instead of rendering the
 * scene from below, the visible atoms are splatted on the CPU into a 2D
 * canvas: one soft disc per atom at its (x, z) footprint, as dark as the atom
 * is close to the plane (full at the plane, none at `far` above it, like
 * drei's depth darkness), max-blended so overlaps do not stack past one atom,
 * then blurred. The canvas is the alpha map of one transparent plane, so the
 * shadow reads the same on both backends and needs no extra render pass.
 *
 * It recomputes in the `update` phase only when its inputs change (frame,
 * hidden types, radii, placement); `frames={0}` keeps the last result, so
 * playback never re-splats per frame.
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';
import { resolveTypeDisplayRadius } from '@atlas/core';
import { LUPI_JOB } from '@atlas/scene';
import { useStore } from './store';

export interface LupiContactShadowProps {
  position?: [number, number, number];
  /** Plane size in world units (square). */
  scale?: number;
  blur?: number;
  /** How far above the plane atoms still cast, world units. */
  far?: number;
  opacity?: number;
  /** Shadow texture size, px. */
  resolution?: number;
  /** Frames to (re)compute; 0 keeps the last result. */
  frames?: number;
  color?: THREE.ColorRepresentation;
  frame: Frame;
  hiddenAtomTypes: ReadonlySet<number>;
}

/** The splat parameters that decide the shadow image. */
export interface ContactShadowSplat {
  /** Plane centre (world). */
  center: readonly [number, number, number];
  /** Plane size (world units). */
  scale: number;
  far: number;
  blur: number;
  resolution: number;
  /** World radius of each atom type (0 = not drawn). */
  radiusForType: (rawType: number) => number;
}

/**
 * drei's blur spreads about `blur / 256` of the plane per tap over four taps;
 * a Gaussian of twice the tap spacing matches its footprint.
 */
export function contactShadowBlurPx(blur: number, resolution: number): number {
  return Math.max(0, (2 * blur * resolution) / 256);
}

/**
 * Splat `frame` into `ctx` (a `resolution²` canvas): white = full shadow.
 * Canvas x follows world +x; canvas y follows world +z (row 0 = the plane's
 * -z edge), which is how a flipY canvas texture lands on a plane rotated
 * -90° about x. Returns the number of atoms drawn.
 */
export function splatContactShadow(
  ctx: CanvasRenderingContext2D,
  frame: Frame,
  hiddenAtomTypes: ReadonlySet<number>,
  splat: ContactShadowSplat,
): number {
  const { center, scale, far, resolution: size } = splat;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  // Max-blend: where footprints overlap, the darker (closer) atom wins.
  ctx.globalCompositeOperation = 'lighten';
  const pxPerWorld = size / Math.max(scale, 1e-6);
  const planeY = center[1];
  const reach = Math.max(far, 1e-6);
  const positions = frame.positions;
  const radiusCache = new Map<number, number>();
  let drawn = 0;
  for (let i = 0; i < frame.natoms; i += 1) {
    const type = frame.types[i];
    if (hiddenAtomTypes.has(type)) continue;
    let radius = radiusCache.get(type);
    if (radius === undefined) {
      radius = splat.radiusForType(type);
      radiusCache.set(type, radius);
    }
    if (!(radius > 0)) continue;
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (y + radius < planeY) continue;
    const height = Math.max(0, y - radius - planeY);
    if (height >= reach) continue;
    const cx = (x - center[0]) * pxPerWorld + size / 2;
    const cy = (z - center[2]) * pxPerWorld + size / 2;
    const r = Math.max(0.75, radius * pxPerWorld);
    if (cx + r < 0 || cy + r < 0 || cx - r > size || cy - r > size) continue;
    const level = Math.round(255 * (1 - height / reach));
    const rim = Math.round(level * 0.8);
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    gradient.addColorStop(0, `rgb(${level},${level},${level})`);
    gradient.addColorStop(0.7, `rgb(${rim},${rim},${rim})`);
    gradient.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    drawn += 1;
  }
  ctx.restore();
  return drawn;
}

interface ShadowSurface {
  splatCanvas: HTMLCanvasElement;
  splat: CanvasRenderingContext2D;
  blurred: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
}

function createSurface(size: number): ShadowSurface | null {
  if (typeof document === 'undefined') return null;
  const splatCanvas = document.createElement('canvas');
  splatCanvas.width = size;
  splatCanvas.height = size;
  const blurCanvas = document.createElement('canvas');
  blurCanvas.width = size;
  blurCanvas.height = size;
  const splat = splatCanvas.getContext('2d');
  const blurred = blurCanvas.getContext('2d');
  if (!splat || !blurred) return null;
  const texture = new THREE.CanvasTexture(blurCanvas);
  // A coverage mask, not a colour: no sRGB decode.
  texture.colorSpace = THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return { splatCanvas, splat, blurred, texture };
}

/** Blur the splat into the texture canvas (a plain copy where `ctx.filter` is missing). */
function blurInto(surface: ShadowSurface, blurPx: number): void {
  const ctx = surface.blurred;
  const size = ctx.canvas.width;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'copy';
  if ('filter' in ctx && blurPx > 0.25) ctx.filter = `blur(${blurPx.toFixed(2)}px)`;
  ctx.drawImage(surface.splatCanvas, 0, 0, size, size);
  ctx.restore();
}

export function LupiContactShadow({
  position = [0, 0, 0],
  scale = 10,
  blur = 1,
  far = 10,
  opacity = 1,
  resolution = 512,
  frames = Infinity,
  color = '#000000',
  frame,
  hiddenAtomTypes,
}: LupiContactShadowProps): JSX.Element | null {
  const atomScale = useStore((s) => s.atomScale);
  const atomTypeScales = useStore((s) => s.atomTypeScales);
  const size = Math.max(16, Math.min(2048, Math.round(resolution)));
  const surface = useMemo(() => createSurface(size), [size]);
  const material = useMemo(() => new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  }), []);

  useEffect(() => () => surface?.texture.dispose(), [surface]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    material.color.set(color);
    material.opacity = opacity;
    const alphaMap = surface?.texture ?? null;
    if (material.alphaMap !== alphaMap) {
      material.alphaMap = alphaMap;
      material.needsUpdate = true;
    }
  }, [color, material, opacity, surface]);

  const [px, py, pz] = position;
  const inputs = useMemo(() => ({
    frame,
    hiddenAtomTypes,
    splat: {
      center: [px, py, pz] as const,
      scale,
      far,
      blur,
      resolution: size,
      radiusForType: (rawType: number) =>
        resolveTypeDisplayRadius(frame, rawType) * atomScale * (atomTypeScales[rawType] ?? 1),
    } satisfies ContactShadowSplat,
  }), [atomScale, atomTypeScales, blur, far, frame, hiddenAtomTypes, px, py, pz, scale, size]);

  const computed = useRef<{ inputs: typeof inputs | null; surface: ShadowSurface | null }>({
    inputs: null,
    surface: null,
  });

  useFrame(
    () => {
      if (!surface) return;
      const last = computed.current;
      const fresh = last.surface !== surface;
      // frames={0} keeps the last result; a fresh surface always gets one.
      if (!fresh && (last.inputs === inputs || frames === 0)) return;
      splatContactShadow(surface.splat, inputs.frame, inputs.hiddenAtomTypes, inputs.splat);
      blurInto(surface, contactShadowBlurPx(inputs.splat.blur, size));
      surface.texture.needsUpdate = true;
      last.inputs = inputs;
      last.surface = surface;
    },
    { phase: 'update', id: LUPI_JOB.contactShadow },
  );

  if (!surface) return null;

  return (
    <mesh
      position={position}
      rotation={[-Math.PI / 2, 0, 0]}
      material={material}
      renderOrder={-10}
      frustumCulled={false}
    >
      <planeGeometry args={[scale, scale]} />
    </mesh>
  );
}
