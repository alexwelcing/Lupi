/**
 * MoleculeShadow — a cheap "blob" shadow that lands on the shell.
 *
 * Deliberately fake and nearly free: a single soft radial-gradient plane, no
 * shadow maps, no extra shadow-casting light, no proxy geometry. It sits at the
 * bottom of the filter shell (sphere or cube) and slides opposite the key
 * light's horizontal direction, stretching a little as the light drops — enough
 * to read as "the molecule is casting onto the shell" without the performance
 * cost of a real shadow pass. When no shell is active the viewer keeps its
 * existing floor ContactShadows instead (see App.tsx).
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

function makeBlobTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.9)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

const DEG = Math.PI / 180;

interface MoleculeShadowProps {
  /** Shell center (molecule centroid). */
  center: [number, number, number];
  /** Molecule bounding radius — drives the blob footprint. */
  moleculeRadius: number;
  /** World radius of the shell; the shadow lands on its bottom. */
  shellRadius: number;
  /** Key-light direction (degrees) — the shadow falls opposite this. */
  azimuthDeg: number;
  elevationDeg: number;
  opacity: number;
}

export function MoleculeShadow({
  center,
  moleculeRadius,
  shellRadius,
  azimuthDeg,
  elevationDeg,
  opacity,
}: MoleculeShadowProps) {
  const tex = useMemo(makeBlobTexture, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  if (!tex || opacity <= 0) return null;

  // Drop the blob to the bottom of the shell, nudged in slightly so it reads as
  // resting on the inner surface rather than clipping the shell skin.
  const surfaceY = center[1] - shellRadius * 0.985;

  // Horizontal offset: opposite the light, larger as the light gets lower. Kept
  // inside the shell footprint so it never slides off the bottom.
  const el = Math.max(0, Math.min(90, elevationDeg)) * DEG;
  const reach = Math.min(shellRadius * 0.55, moleculeRadius * 1.2) * (1 - Math.sin(el));
  const az = azimuthDeg * DEG;
  const offX = -Math.sin(az) * reach;
  const offZ = -Math.cos(az) * reach;

  // Footprint grows a touch as the light lowers (longer shadow feel), capped to
  // the shell so it stays contained.
  const base = Math.min(moleculeRadius * 2.2, shellRadius * 1.7);
  const planeSize = base * (1 + (1 - Math.sin(el)) * 0.35);

  return (
    <mesh
      position={[center[0] + offX, surfaceY, center[2] + offZ]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={-45}
      frustumCulled={false}
    >
      <planeGeometry args={[planeSize, planeSize]} />
      <meshBasicMaterial
        map={tex}
        transparent
        opacity={Math.min(0.8, opacity)}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
