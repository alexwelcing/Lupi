/**
 * studioEnvironment — the procedural "softbox" scientific-studio environment.
 *
 * Replaces the stock Drei 'apartment' room HDRI (lebombo_1k.hdr), whose
 * window panes and furniture read as literal room reflections on polished
 * atoms. Instead we author a tiny emissive light-rig scene — key softbox,
 * cool fill card, overhead strip, rim card, and a graded backdrop dome — and
 * prefilter it once with PMREMGenerator.fromScene at startup.
 *
 * Properties that matter:
 * - Zero network: everything is generated on-device (no HDR fetch).
 * - Zero per-frame cost: one PMREM bake at install time, then it's a static
 *   CubeUV texture exactly like the fetched presets.
 * - Reflections read as soft studio softboxes with feathered edges — the
 *   falloff texture keeps even roughness-0 surfaces free of hard rectangles.
 * - Tunable: the whole look is data (SCIENTIFIC_STUDIO_RIG below).
 *
 * Light directions deliberately match the analytic rig defaults in the store
 * (key az 40 / el 45, fill az -120 / el 10, rim az 160 / el 30) so specular
 * highlights and IBL agree on where the light comes from.
 */
import * as THREE from 'three';
import { markSceneEnvironmentReady } from './sceneEnvironment';

/** One rectangular emissive panel on the rig sphere, aimed at the origin. */
export interface StudioPanel {
  /** Horizontal angle, degrees. 0 faces +Z, matching the analytic light rig. */
  azimuthDeg: number;
  /** Vertical angle, degrees. 90 is straight up. */
  elevationDeg: number;
  /** Panel width / height in rig units (rig radius is RIG_DISTANCE). */
  width: number;
  height: number;
  /** Linear emission color (hex). Kept near-white for a neutral studio. */
  color: number;
  /** HDR emission multiplier. The key box should dominate. */
  intensity: number;
}

export interface ScientificStudioRig {
  panels: StudioPanel[];
  /** Backdrop dome gradient, bottom → top, linear luminance. */
  backdropBottom: number;
  backdropTop: number;
  /** Subtle blue-grey tint of the backdrop, as a hex color. */
  backdropTint: number;
}

/** Distance of the panels from the origin. Only direction matters for IBL,
 *  but keeping everything on one sphere makes the solid angles legible. */
const RIG_DISTANCE = 20;
const BACKDROP_RADIUS = 60;

/** The authored look. Edit here to retune the studio. Bump
 *  SOFTBOX_ENVIRONMENT_REVISION in sceneEnvironment.ts when the change should
 *  invalidate capture identity. */
export const SCIENTIFIC_STUDIO_RIG: ScientificStudioRig = {
  panels: [
    // Key softbox — big, warm-neutral, upper front-left. The main highlight.
    { azimuthDeg: 40, elevationDeg: 45, width: 18, height: 12, color: 0xfff2e2, intensity: 22 },
    // Cool fill card — opposite side, low, wide and dim. Lifts the shadow side.
    { azimuthDeg: -120, elevationDeg: 10, width: 20, height: 14, color: 0xdde6f7, intensity: 4.5 },
    // Overhead strip — long thin light for the classic top highlight on spheres.
    { azimuthDeg: -30, elevationDeg: 80, width: 26, height: 4.5, color: 0xf4f7fb, intensity: 10 },
    // Rim card — behind and above, narrow; edges the silhouettes.
    { azimuthDeg: 160, elevationDeg: 30, width: 10, height: 7, color: 0xeef3ff, intensity: 7 },
    // Floor bounce — soft, very dim warm card below, so the lower hemisphere
    // is not a dead void on glossy materials.
    { azimuthDeg: 20, elevationDeg: -65, width: 24, height: 16, color: 0xf7ecdd, intensity: 0.9 },
  ],
  backdropBottom: 0.010,
  backdropTop: 0.055,
  backdropTint: 0xbfcbdb,
};

const DEG = Math.PI / 180;

function rigPosition(azimuthDeg: number, elevationDeg: number, radius: number): THREE.Vector3 {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  return new THREE.Vector3(
    radius * Math.cos(el) * Math.sin(az),
    radius * Math.sin(el),
    radius * Math.cos(el) * Math.cos(az),
  );
}

/** Shared soft-rectangle falloff mask. Feathered edges are what turn a bare
 *  emissive quad into a softbox: even a mirror-polished sphere reflects a
 *  glow, not a hard-edged rectangle. */
export function buildSoftboxFalloffTexture(size = 128, margin = 0.42): THREE.DataTexture {
  const data = new Float32Array(size * size * 4);
  const smooth = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    const fy = smooth(0, margin, v) * smooth(1, 1 - margin, v);
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const fx = smooth(0, margin, u) * smooth(1, 1 - margin, u);
      const f = fx * fy;
      const i = (y * size + x) * 4;
      data[i] = f;
      data[i + 1] = f;
      data[i + 2] = f;
      data[i + 3] = 1;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Vertical gradient for the backdrop dome: near-black floor rising to a
 *  faint cool grey overhead, so reflections stay grounded, never windowed. */
function buildBackdropGradientTexture(rig: ScientificStudioRig, steps = 64): THREE.DataTexture {
  const tint = new THREE.Color(rig.backdropTint);
  const data = new Float32Array(steps * 4);
  for (let i = 0; i < steps; i++) {
    // SphereGeometry uv.y runs 0 at the bottom pole to 1 at the top pole.
    const t = i / (steps - 1);
    const lum = rig.backdropBottom + (rig.backdropTop - rig.backdropBottom) * t * t;
    data[i * 4] = tint.r * lum;
    data[i * 4 + 1] = tint.g * lum;
    data[i * 4 + 2] = tint.b * lum;
    data[i * 4 + 3] = 1;
  }
  const texture = new THREE.DataTexture(data, 1, steps, THREE.RGBAFormat, THREE.FloatType);
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Build the emissive rig scene. Pure Three.js objects — cheap to construct,
 *  rendered exactly once by PMREMGenerator.fromScene, then disposed. */
export function buildScientificStudioScene(
  rig: ScientificStudioRig = SCIENTIFIC_STUDIO_RIG,
): { scene: THREE.Scene; dispose: () => void } {
  const scene = new THREE.Scene();
  const disposables: Array<{ dispose(): void }> = [];

  const falloff = buildSoftboxFalloffTexture();
  disposables.push(falloff);

  for (const panel of rig.panels) {
    const geometry = new THREE.PlaneGeometry(panel.width, panel.height);
    const material = new THREE.MeshBasicMaterial({ map: falloff, side: THREE.DoubleSide });
    material.color.set(panel.color).multiplyScalar(panel.intensity);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(rigPosition(panel.azimuthDeg, panel.elevationDeg, RIG_DISTANCE));
    mesh.lookAt(0, 0, 0);
    scene.add(mesh);
    disposables.push(geometry, material);
  }

  const domeGradient = buildBackdropGradientTexture(rig);
  const domeGeometry = new THREE.SphereGeometry(BACKDROP_RADIUS, 32, 16);
  const domeMaterial = new THREE.MeshBasicMaterial({ map: domeGradient, side: THREE.BackSide });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  scene.add(dome);
  disposables.push(domeGradient, domeGeometry, domeMaterial);

  return {
    scene,
    dispose: () => {
      for (const resource of disposables) resource.dispose();
    },
  };
}

interface StudioPmremTarget {
  texture: THREE.Texture;
  dispose(): void;
}

interface StudioPmremGenerator {
  fromScene(scene: THREE.Scene, sigma?: number, near?: number, far?: number): StudioPmremTarget;
  dispose(): void;
}

/**
 * Bake the softbox rig into a PMREM CubeUV texture and commit it as
 * scene.environment, tagged with its capture identity. Runs once from
 * layout-effect time; the returned cleanup restores the previous environment
 * and disposes everything this install allocated.
 */
export function installScientificStudioEnvironment(
  scene: THREE.Scene,
  createGenerator: () => StudioPmremGenerator,
  rig: ScientificStudioRig = SCIENTIFIC_STUDIO_RIG,
): () => void {
  const previous = scene.environment;
  const built = buildScientificStudioScene(rig);
  const generator = createGenerator();
  let target: StudioPmremTarget | null = null;
  try {
    // Near/far only need to bracket the rig geometry (panels at 20, dome 60).
    target = generator.fromScene(built.scene, 0, 0.1, 200);
  } finally {
    generator.dispose();
    built.dispose();
  }

  const texture = target.texture;
  markSceneEnvironmentReady(texture, 'softbox');
  scene.environment = texture;

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (scene.environment === texture) scene.environment = previous;
    target?.dispose();
    target = null;
  };
}
