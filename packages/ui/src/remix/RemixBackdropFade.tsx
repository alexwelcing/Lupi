/**
 * RemixBackdropFade — the backdrop half of a Remix morph.
 *
 * Between two plain gradients (the common case: every r1 backdrop without
 * worlds is one), the store switches to the new backdrop at the start of the
 * morph, and this dome covers the swap: an opaque sphere around the camera,
 * drawn first, that shows the old gradient blending into the new one in
 * linear light, sampled by view direction exactly as `scene.background`
 * samples an equirectangular texture. At the end it unmounts over a
 * backdrop that already matches it.
 *
 * Background-flagged (the post chain composites it back untouched, like the
 * backdrop it stands in for) and tagged as the export background layer, so a
 * capture that lands mid-morph treats it as the backdrop.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { equirectUV, float, mix, positionWorldDirection, texture, uniform, vec4 } from 'three/tsl';
import { requestLupiFrames } from '@atlas/scene';
import { createGradientEquirectTexture } from '../equirectTexture';
import { markBackgroundMaterial } from '../postprocess/backgroundMask';
import { LUPI_EXPORT_BACKGROUND_LAYER, LUPI_EXPORT_LAYER_KEY } from '../export/renderCaptureState';
import { lookMorphProgress, subscribeLookMorph, type BackdropFade } from './lookMorph';

type N = any;

/** Gradients are smooth: a 1024×512 panorama is plenty for 600 ms. */
const FADE_TEXTURE_HEIGHT = 512;
const FADE_DOME_RADIUS = 5000;

export function RemixBackdropFade() {
  const [fade, setFade] = useState<BackdropFade | null>(null);
  useEffect(() => subscribeLookMorph((event) => {
    setFade(event.phase === 'start' ? event.fade : null);
    requestLupiFrames();
  }), []);
  if (!fade) return null;
  return <FadeDome fade={fade} />;
}

function FadeDome({ fade }: { fade: BackdropFade }) {
  const { camera } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);
  const parts = useMemo(() => {
    const from = createGradientEquirectTexture(fade.from.top, fade.from.bottom, undefined, FADE_TEXTURE_HEIGHT, fade.from.style);
    const to = createGradientEquirectTexture(fade.to.top, fade.to.bottom, undefined, FADE_TEXTURE_HEIGHT, fade.to.style);
    for (const map of [from, to]) {
      map.generateMipmaps = false;
      map.minFilter = THREE.LinearFilter;
    }
    const progress = uniform(0);
    const uv: N = equirectUV(positionWorldDirection);
    const colorFrom: N = (texture(from, uv) as N).level(0);
    const colorTo: N = (texture(to, uv) as N).level(0);
    const material = new THREE.MeshBasicNodeMaterial({
      side: THREE.BackSide,
      transparent: false,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: false,
    });
    material.name = 'lupi-remix-backdrop-fade';
    material.colorNode = vec4(mix(colorFrom.rgb, colorTo.rgb, progress as N) as N, float(1.0));
    markBackgroundMaterial(material);
    const geometry = new THREE.SphereGeometry(FADE_DOME_RADIUS, 48, 24);
    return { from, to, progress, material, geometry };
  }, [fade]);

  useEffect(() => () => {
    parts.from.dispose();
    parts.to.dispose();
    parts.material.dispose();
    parts.geometry.dispose();
  }, [parts]);

  // The dome rides on the camera, like the panorama dome it stands in for.
  useFrame(() => {
    parts.progress.value = lookMorphProgress();
    meshRef.current?.position.copy(camera.position);
    requestLupiFrames();
  });

  return (
    <mesh
      ref={meshRef}
      geometry={parts.geometry}
      material={parts.material}
      position={camera.position.toArray()}
      frustumCulled={false}
      renderOrder={-999}
      userData={{ [LUPI_EXPORT_LAYER_KEY]: LUPI_EXPORT_BACKGROUND_LAYER }}
    />
  );
}
