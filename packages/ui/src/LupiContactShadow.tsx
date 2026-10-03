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
 *
 * The Specimen look (wave 2): the penumbra widens and pales with height
 * (`spread`), the shadow leans away from the key light (`skew`), each disc
 * is a pre-rendered opaque sprite drawn with `lighten` (an exact max blend,
 * an order of magnitude cheaper than a gradient per atom), and the plane
 * fades out as the camera drops toward the floor and while an arrival or a
 * scatter carries the atoms (display motion; whole at rest and in every
 * capture, where the motion weight is zero).
 */
import { useEffect, useMemo, useRef, type JSX } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { cameraPosition, float, length, mix, select, smoothstep, texture, uniform, vec3 } from 'three/tsl';
import type { Frame } from '@atlas/core/types';
import { resolveTypeDisplayRadius } from '@atlas/core';
import { DISPLAY_MOTION, DISPLAY_MOTION_TUNING, LUPI_JOB } from '@atlas/scene';
import { useStore } from './store';

// Graph-building code works on untyped nodes (spike G13).
type N = any;

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
  /** Penumbra growth per unit height above the plane (0 = straight discs). */
  spread?: number;
  /** World (x, z) offset of the shadow per unit height (leaning away from the key light). */
  skew?: readonly [number, number];
  /** Fade the plane out as the camera drops toward (or below) it. Default true. */
  fadeWithCamera?: boolean;
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
  /** Penumbra growth per unit height (default 0). */
  spread?: number;
  /** World (x, z) offset per unit height (default none). */
  skew?: readonly [number, number];
}

/** Shades of the pre-rendered disc sprites (the darkness quantization). */
const SPRITE_LEVELS = 48;
const SPRITE_SIZE = 64;
let sprites: HTMLCanvasElement[] | null = null;

/**
 * One opaque square sprite per darkness level: a radial gradient (level at
 * the centre, 0.8·level at 70 %, black at the rim and in the corners). Being
 * opaque, `lighten` composites it as an exact per-channel max.
 */
function shadowSprites(): HTMLCanvasElement[] | null {
  if (sprites) return sprites;
  if (typeof document === 'undefined') return null;
  const built: HTMLCanvasElement[] = [];
  for (let level = 0; level <= SPRITE_LEVELS; level += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITE_SIZE;
    canvas.height = SPRITE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const value = Math.round((255 * level) / SPRITE_LEVELS);
    const rim = Math.round(value * 0.8);
    const half = SPRITE_SIZE / 2;
    const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, `rgb(${value},${value},${value})`);
    gradient.addColorStop(0.7, `rgb(${rim},${rim},${rim})`);
    gradient.addColorStop(1, 'rgb(0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
    built.push(canvas);
  }
  sprites = built;
  return sprites;
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
  const spread = Math.max(0, splat.spread ?? 0);
  const skewX = splat.skew?.[0] ?? 0;
  const skewZ = splat.skew?.[1] ?? 0;
  const discs = shadowSprites();
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
    // Higher atoms cast wider, paler discs, leaning away from the key.
    const cx = (x + skewX * height - center[0]) * pxPerWorld + size / 2;
    const cy = (z + skewZ * height - center[2]) * pxPerWorld + size / 2;
    const worldRadius = radius + spread * height;
    const r = Math.max(0.75, worldRadius * pxPerWorld);
    if (cx + r < 0 || cy + r < 0 || cx - r > size || cy - r > size) continue;
    const falloff = 1 - height / reach;
    const darkness = falloff * Math.sqrt(radius / worldRadius);
    if (discs) {
      const level = Math.round(Math.max(0, Math.min(1, darkness)) * SPRITE_LEVELS);
      if (level === 0) continue;
      ctx.drawImage(discs[level], cx - r, cy - r, 2 * r, 2 * r);
    } else {
      const level = Math.round(255 * darkness);
      const rim = Math.round(level * 0.8);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      gradient.addColorStop(0, `rgb(${level},${level},${level})`);
      gradient.addColorStop(0.7, `rgb(${rim},${rim},${rim})`);
      gradient.addColorStop(1, 'rgb(0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
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
  spread = 0,
  skew,
  fadeWithCamera = true,
}: LupiContactShadowProps): JSX.Element | null {
  const atomScale = useStore((s) => s.atomScale);
  const atomTypeScales = useStore((s) => s.atomTypeScales);
  const size = Math.max(16, Math.min(2048, Math.round(resolution)));
  const surface = useMemo(() => createSurface(size), [size]);
  const shading = useMemo(() => createShadowMaterial(), []);
  const material = shading.material;

  useEffect(() => () => surface?.texture.dispose(), [surface]);
  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    shading.color.value.set(color);
    shading.opacity.value = opacity;
    shading.cameraFade.value = fadeWithCamera ? 1 : 0;
    if (surface) shading.mask.value = surface.texture;
  }, [color, fadeWithCamera, opacity, shading, surface]);

  const [px, py, pz] = position;
  useEffect(() => {
    shading.plane.value.set(px, py, pz);
  }, [px, py, pz, shading]);
  const skewX = skew?.[0] ?? 0;
  const skewZ = skew?.[1] ?? 0;
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
      spread,
      skew: [skewX, skewZ] as const,
    } satisfies ContactShadowSplat,
  }), [atomScale, atomTypeScales, blur, far, frame, hiddenAtomTypes, px, py, pz, scale, size, spread, skewX, skewZ]);

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

interface ShadowShading {
  material: THREE.MeshBasicNodeMaterial;
  mask: { value: THREE.Texture };
  color: { value: THREE.Color };
  opacity: { value: number };
  /** 1 fades the plane with camera elevation. */
  cameraFade: { value: number };
  /** The plane centre (world). */
  plane: { value: THREE.Vector3 };
}

let emptyMask: THREE.DataTexture | null = null;
function emptyShadowMask(): THREE.DataTexture {
  if (!emptyMask) {
    emptyMask = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    emptyMask.needsUpdate = true;
  }
  return emptyMask;
}

/**
 * The shadow plane's node material: the mask's red channel times opacity,
 * times two fades.
 * - Camera: the floor is an invisible table, seen from above. It fades out
 *   as the camera's elevation over the plane drops below ~13° and is gone at
 *   ~2°, so an orbit underneath never sees a dark sheet across the molecule.
 *   `cameraPosition` follows whichever camera renders (captures included).
 * - Display motion: while an arrival condenses (or a scatter puffs out and
 *   back) the shadow fades with it, from the display-motion uniforms
 *   themselves, so it is whole at rest and in every capture.
 */
function createShadowMaterial(): ShadowShading {
  const mask: N = texture(emptyShadowMask());
  const color: N = uniform(new THREE.Color('#000000'));
  const opacity: N = uniform(1);
  const cameraFade: N = uniform(1);
  const plane: N = uniform(new THREE.Vector3());

  const toCamera: N = (cameraPosition as N).sub(plane);
  const elevation: N = toCamera.y.div(length(toCamera).max(1e-4));
  const elevationFade: N = mix(float(1), smoothstep(0.035, 0.22, elevation), cameraFade);

  const M = DISPLAY_MOTION as unknown as Record<string, N>;
  const rise = DISPLAY_MOTION_TUNING.scatterRiseS;
  const elapsed: N = M.uMotionNow.sub(M.uArrivalT0);
  const duration: N = M.uArrivalDuration.max(1e-3);
  const condensing: N = smoothstep(0, duration, elapsed);
  const scattering: N = select(
    elapsed.lessThan(rise),
    smoothstep(0, rise, elapsed).oneMinus(),
    smoothstep(rise, duration.add(rise), elapsed),
  );
  const arriving: N = select(M.uArrivalMode.greaterThan(2.5), scattering, condensing);
  const motionFade: N = mix(float(1), arriving, M.uMotionWeight.mul(M.uArrivalWeight).clamp(0, 1));

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  material.name = 'lupi-contact-shadow';
  material.colorNode = vec3(color);
  material.opacityNode = (mask as N).r.mul(opacity).mul(elevationFade).mul(motionFade);
  return { material, mask, color, opacity, cameraFade, plane };
}
