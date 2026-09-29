/**
 * plate — the reference testbed case (WP0; frozen): the #101817 plate and one
 * MeshBasicNodeMaterial quad of #d5ef9c.
 *
 * Proves per backend that output colour is exact (a single sRGB encode, no
 * renderer tone mapping), that the runtime record names the backend actually
 * in use (and `?renderer=webgl2` forces WebGL2), and that the drawing buffer
 * is the CSS size × DPR.
 */
import { useEffect, useMemo } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import { getLupiRendererRuntime, isWebGL2Forced } from '../../viewer/createLupiRenderer';
import { harnessAssert, harnessHold, useHarnessProbe } from '../harness';

const QUAD_COLOR = '#d5ef9c';
const QUAD_SIZE = 1.5;

export default function PlateCase() {
  const renderer = useThree((state) => state.renderer);
  const size = useThree((state) => state.size);
  const dpr = useThree((state) => state.viewport.dpr);
  const material = useMemo(() => new THREE.MeshBasicNodeMaterial({ color: QUAD_COLOR }), []);

  useEffect(() => () => material.dispose(), [material]);

  useHarnessProbe('quad', [0, 0, 0], { rgb: [213, 239, 156], tol: 3 });
  useHarnessProbe('plate', [0, -QUAD_SIZE, 0], { rgb: [16, 24, 23], tol: 3 });

  useEffect(() => {
    // Judge after a frame, once onCreated has recorded the runtime and R3F
    // has sized the drawing buffer.
    const release = harnessHold('plate');
    const frame = requestAnimationFrame(() => {
      const runtime = getLupiRendererRuntime();
      const backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
      harnessAssert(
        'runtime record names the active backend',
        runtime?.backend === backend,
        `runtime=${runtime?.backend ?? 'none'} renderer.backend=${backend}`,
      );
      if (isWebGL2Forced()) {
        harnessAssert(
          '?renderer=webgl2 forces WebGL2',
          backend === 'webgl2' && runtime?.forced === true,
          `backend=${backend} forced=${String(runtime?.forced)}`,
        );
      }
      harnessAssert(
        'no renderer tone mapping, sRGB output',
        renderer.toneMapping === THREE.NoToneMapping && renderer.outputColorSpace === THREE.SRGBColorSpace,
        `toneMapping=${renderer.toneMapping} outputColorSpace=${renderer.outputColorSpace}`,
      );
      const canvas = renderer.domElement;
      const expectedDpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
      const width = Math.floor(size.width * dpr);
      const height = Math.floor(size.height * dpr);
      harnessAssert(
        'drawing buffer is CSS size × DPR',
        dpr === expectedDpr && Math.abs(canvas.width - width) <= 1 && Math.abs(canvas.height - height) <= 1,
        `buffer=${canvas.width}x${canvas.height} css=${size.width}x${size.height} dpr=${dpr} devicePixelRatio=${window.devicePixelRatio}`,
      );
      release();
    });
    return () => {
      cancelAnimationFrame(frame);
      release();
    };
  }, [renderer, size, dpr]);

  return (
    <mesh material={material}>
      <planeGeometry args={[QUAD_SIZE, QUAD_SIZE]} />
    </mesh>
  );
}
