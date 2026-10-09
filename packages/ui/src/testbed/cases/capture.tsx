/**
 * capture — WP6's testbed case: the capture engine, the axes gizmo, picking.
 *
 * An asymmetric scene on the plate: a red quad top-left, a grey #808080 quad
 * in the centre and a half-alpha #ff8000 quad bottom-right. Captures run the
 * same path as image exports (ViewerCaptureService → capture transaction →
 * renderSceneToPixels, in the `lupi-capture` phase) and assert, per backend:
 *
 * - orientation: the top-left of the image is red (rows are not flipped);
 * - grey is 128 ± 1 (one sRGB encode, linear un-premultiply);
 * - transparent output: empty pixels have alpha 0 and the orange quad is
 *   straight-alpha [255,128,0,128] ± 2; at 100×60 and at 1024×1024;
 * - the PNG encode round-trips and the saved-view thumbnail is a non-flat
 *   320×200 JPEG under 60,000 characters;
 * - the opaque capture at canvas size matches the screen: its pixels become
 *   the expected colours (± 2) of on-screen probes the smoke runner judges.
 *
 * The SVG axes gizmo must be in the canvas container and move with the
 * camera; a synthetic click at a projected atom must select that atom.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';
import { SpatialHash3D } from '@atlas/scene';
import { AtomPicker } from '@atlas/scene/AtomPicker';
import { beginImageCaptureTransaction } from '../../export/renderCaptureState';
import {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_MAX_DATA_URL_LENGTH,
  THUMBNAIL_WIDTH,
  ViewerCaptureService,
  compileSceneForCapture,
  readbackToCanvas,
  renderSceneToPixels,
  rendererBackendOf,
  requestViewerThumbnail,
  runViewerCapture,
  type RasterReadback,
  type ViewerCaptureContext,
} from '../../export/renderTargetReadback';
import { AxesGizmo } from '../../viewer/AxesGizmo';
import { HARNESS_PLATE, harnessAssert, harnessHold, useHarnessProbe } from '../harness';

type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];

const QUAD = 0.6;
const RED: Vec3 = [-0.8, 0.75, 0];
const GREY: Vec3 = [0, 0, 0];
const ORANGE: Vec3 = [0.8, -0.75, 0];
/** Empty plate: top-right, and bottom-left (where a flipped image would put red's row). */
const EMPTY: Vec3 = [0.8, 0.75, 0];
const EMPTY_LOW: Vec3 = [-0.8, -0.75, 0];

interface Captured {
  readback: RasterReadback;
  camera: THREE.Camera;
}

interface ScreenExpectations {
  red: Rgba;
  grey: Rgba;
  orange: Rgba;
  plate: Rgba;
}

function sample({ readback, camera }: Captured, world: Vec3): Rgba {
  const point = new THREE.Vector3(...world).project(camera);
  const x = Math.min(readback.width - 1, Math.max(0, Math.floor(((point.x + 1) / 2) * readback.width)));
  const y = Math.min(readback.height - 1, Math.max(0, Math.floor(((1 - point.y) / 2) * readback.height)));
  const i = (y * readback.width + x) * 4;
  const d = readback.rgba;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

const near = (actual: readonly number[], expected: readonly number[], tol: number) =>
  expected.every((value, i) => Math.abs(actual[i] - value) <= tol);

const fmt = (value: readonly number[]) => `[${value.join(',')}]`;

/** The export path: a capture transaction around renderSceneToPixels, run in `lupi-capture`. */
function captureScene(width: number, height: number, transparent: boolean): Promise<Captured> {
  const pending = runViewerCapture(async (context: ViewerCaptureContext) => {
    const transaction = beginImageCaptureTransaction({
      scene: context.scene,
      camera: context.camera,
      targetWidth: width,
      targetHeight: height,
      transparent,
    });
    try {
      const readback = await transaction.withCaptureScene(() => renderSceneToPixels({
        renderer: context.renderer,
        scene: context.scene,
        camera: transaction.camera,
        width,
        height,
        transparent,
        clearColor: context.plate,
      }));
      return { readback, camera: transaction.camera };
    } finally {
      transaction.restore();
    }
  });
  if (!pending) throw new Error('no viewer capture service is mounted');
  return pending;
}

function nextFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => (left <= 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(count);
  });
}

async function pngRoundTrip(readback: RasterReadback): Promise<Uint8ClampedArray> {
  const blob = await new Promise<Blob | null>((resolve) => readbackToCanvas(readback).toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob returned null');
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D context');
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

async function decodeLuminanceSpread(dataUrl: string, width: number, height: number): Promise<number> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D context');
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, width, height).data;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i += 4) {
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    sum += l;
    sumSq += l * l;
  }
  const n = data.length / 4;
  return Math.sqrt(Math.max(0, sumSq / n - (sum / n) ** 2));
}

function Quad({ at, color, opacity = 1 }: { at: Vec3; color: string; opacity?: number }) {
  const material = useMemo(() => {
    const m = new THREE.MeshBasicNodeMaterial({ color });
    if (opacity < 1) {
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = false;
    }
    return m;
  }, [color, opacity]);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <mesh position={at} material={material}>
      <planeGeometry args={[QUAD, QUAD]} />
    </mesh>
  );
}

/** On-screen probes whose expected colours come from the canvas-size capture. */
function ScreenProbes({ expected, onDeclared }: { expected: ScreenExpectations; onDeclared: () => void }) {
  const rgb = (value: Rgba) => ({ rgb: [value[0], value[1], value[2]] as [number, number, number], tol: 2 });
  useHarnessProbe('screen matches capture: red', RED, rgb(expected.red));
  useHarnessProbe('screen matches capture: grey', GREY, rgb(expected.grey));
  useHarnessProbe('screen matches capture: orange over plate', ORANGE, rgb(expected.orange));
  useHarnessProbe('screen matches capture: plate', EMPTY, rgb(expected.plate));
  useEffect(() => {
    onDeclared();
  }, [onDeclared]);
  return null;
}

function pickerFrame(): Frame {
  const atoms = [RED, GREY, ORANGE];
  return {
    timestep: 0,
    natoms: atoms.length,
    boxBounds: new Float64Array([-2, 2, -2, 2, -2, 2]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: new Int32Array([1, 2, 3]),
    types: new Int32Array([8, 6, 7]),
    positions: new Float32Array(atoms.flat()),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

export default function CaptureCase() {
  const renderer = useThree((state) => state.renderer);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const [expected, setExpected] = useState<ScreenExpectations | null>(null);
  const releaseRef = useRef<() => void>(() => {});
  const selectedRef = useRef<number[] | null>(null);

  const frame = useMemo(pickerFrame, []);
  const spatialHash = useMemo(() => {
    const hash = new SpatialHash3D(3.0);
    hash.build(frame.positions, frame.natoms);
    return hash;
  }, [frame]);

  useEffect(() => {
    let live = true;
    const release = harnessHold('capture');
    releaseRef.current = release;
    const canvasWidth = Math.max(1, Math.round(size.width));
    const canvasHeight = Math.max(1, Math.round(size.height));
    const backend = rendererBackendOf(renderer);

    const run = async () => {
      // Warm-up exactly as an export does, then the captures.
      const warm = runViewerCapture((context) => {
        const transaction = beginImageCaptureTransaction({
          scene: context.scene,
          camera: context.camera,
          targetWidth: 1024,
          targetHeight: 1024,
          transparent: false,
        });
        return transaction.withCaptureScene(() => compileSceneForCapture({
          renderer: context.renderer,
          scene: context.scene,
          camera: transaction.camera,
          width: 1024,
          height: 1024,
        })).finally(() => transaction.restore());
      });
      if (!warm) throw new Error('no viewer capture service is mounted');
      await warm;

      const plate = await runViewerCapture(async ({ plate: resolved }) => resolved.getHexString());
      harnessAssert('opaque clear colour is the viewer plate', `#${plate}` === HARNESS_PLATE, `#${plate}`);

      // Opaque 100×60: orientation and exact grey.
      const small = await captureScene(100, 60, false);
      harnessAssert('capture backend is the renderer backend', small.readback.backend === backend, `${small.readback.backend} vs ${backend}`);
      const redSmall = sample(small, RED);
      harnessAssert('100×60 opaque: top-left is red (orientation)', near(redSmall, [255, 0, 0, 255], 2), fmt(redSmall));
      const lowSmall = sample(small, EMPTY_LOW);
      harnessAssert('100×60 opaque: bottom-left is plate (not flipped)', near(lowSmall, [16, 24, 23, 255], 2), fmt(lowSmall));
      const greySmall = sample(small, GREY);
      harnessAssert('100×60 opaque: grey is 128 ± 1', near(greySmall, [128, 128, 128, 255], 1), fmt(greySmall));
      const rgba = small.readback.rgba;
      const corner = [rgba[(100 - 1) * 4 + 3], rgba[(60 * 100 - 1) * 4 + 3]];
      harnessAssert('100×60 opaque: every corner is opaque', corner.every((a) => a === 255), fmt(corner));
      const png = await pngRoundTrip(small.readback);
      const greyIndex = (Math.floor(30) * 100 + 50) * 4;
      const pngGrey = [png[greyIndex], png[greyIndex + 1], png[greyIndex + 2], png[greyIndex + 3]];
      harnessAssert('PNG encode round-trips the grey', near(pngGrey, [128, 128, 128, 255], 1), fmt(pngGrey));

      // Transparent at two sizes: alpha 0 on empty pixels, straight-alpha orange.
      for (const [width, height] of [[100, 60], [1024, 1024]] as const) {
        const shot = await captureScene(width, height, true);
        const label = `${width}×${height} transparent`;
        const empty = sample(shot, EMPTY);
        const cornerAlpha = shot.readback.rgba[(width - 1) * 4 + 3];
        harnessAssert(`${label}: empty and corner alpha are 0`, empty[3] === 0 && cornerAlpha === 0, `empty=${fmt(empty)} corner alpha=${cornerAlpha}`);
        const orange = sample(shot, ORANGE);
        harnessAssert(`${label}: orange is straight [255,128,0,128] ± 2`, near(orange, [255, 128, 0, 128], 2), fmt(orange));
        const red = sample(shot, RED);
        harnessAssert(`${label}: red is opaque red, top-left`, near(red, [255, 0, 0, 255], 2), fmt(red));
        const grey = sample(shot, GREY);
        harnessAssert(`${label}: grey is 128 ± 1`, near(grey, [128, 128, 128, 255], 1), fmt(grey));
      }

      // Saved-view thumbnail through the same service.
      const thumbnail = await requestViewerThumbnail();
      if (!thumbnail) {
        harnessAssert('thumbnail is a JPEG data URL', false, 'requestViewerThumbnail returned null');
      } else {
        const spread = await decodeLuminanceSpread(thumbnail.dataUrl, thumbnail.width, thumbnail.height);
        harnessAssert(
          'thumbnail is a non-flat 320×200 JPEG under the size cap',
          thumbnail.dataUrl.startsWith('data:image/jpeg')
            && thumbnail.width === THUMBNAIL_WIDTH
            && thumbnail.height === THUMBNAIL_HEIGHT
            && thumbnail.dataUrl.length <= THUMBNAIL_MAX_DATA_URL_LENGTH
            && spread > 8,
          `${thumbnail.width}x${thumbnail.height} chars=${thumbnail.dataUrl.length} luminanceStd=${spread.toFixed(1)}`,
        );
      }

      // Axes gizmo: an SVG in the canvas container whose X axis follows the camera.
      const gizmo = renderer.domElement.parentElement?.parentElement?.querySelector('svg[data-testid="axes-gizmo"]');
      const xLine = gizmo?.querySelector('g[data-axis="X"] line');
      harnessAssert('axes gizmo SVG is in the canvas container', Boolean(gizmo && xLine && gizmo.querySelectorAll('line').length === 3));
      if (xLine) {
        await nextFrames(3);
        const before = `${xLine.getAttribute('x2')},${xLine.getAttribute('y2')}`;
        const savedPosition = camera.position.clone();
        const savedQuaternion = camera.quaternion.clone();
        camera.position.set(3.5, 2, 3.5);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();
        await nextFrames(3);
        const after = `${xLine.getAttribute('x2')},${xLine.getAttribute('y2')}`;
        camera.position.copy(savedPosition);
        camera.quaternion.copy(savedQuaternion);
        camera.updateMatrixWorld();
        await nextFrames(3);
        const restored = `${xLine.getAttribute('x2')},${xLine.getAttribute('y2')}`;
        harnessAssert('axes gizmo X endpoint moves with the camera', before !== after && restored === before, `before=${before} rotated=${after} restored=${restored}`);
      }

      // Picking: a synthetic click at the projected orange atom selects atom 2.
      const canvas = renderer.domElement as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const projected = new THREE.Vector3(...ORANGE).project(camera);
      const clientX = rect.left + ((projected.x + 1) / 2) * rect.width;
      const clientY = rect.top + ((1 - projected.y) / 2) * rect.height;
      selectedRef.current = null;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX, clientY, bubbles: true }));
      canvas.dispatchEvent(new MouseEvent('click', { clientX, clientY, bubbles: true }));
      await nextFrames(3);
      const selected = selectedRef.current as number[] | null;
      harnessAssert('a click at a projected atom selects it', selected?.length === 1 && selected[0] === 2, `selected=${JSON.stringify(selected)}`);

      // Finally the canvas-size capture that the on-screen probes compare against.
      const screen = await captureScene(canvasWidth, canvasHeight, false);
      const values: ScreenExpectations = {
        red: sample(screen, RED),
        grey: sample(screen, GREY),
        orange: sample(screen, ORANGE),
        plate: sample(screen, EMPTY),
      };
      harnessAssert('canvas-size opaque: grey is 128 ± 1', near(values.grey, [128, 128, 128, 255], 1), fmt(values.grey));
      if (live) setExpected(values);
      else release();
    };

    run().catch((error: unknown) => {
      harnessAssert('capture flow completes', false, error instanceof Error ? `${error.message}` : String(error));
      release();
    });
    return () => {
      live = false;
      release();
    };
    // Run once per mounted renderer; the size at mount is the canvas size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderer]);

  return (
    <>
      <ViewerCaptureService />
      <Quad at={RED} color="#ff0000" />
      <Quad at={GREY} color="#808080" />
      <Quad at={ORANGE} color="#ff8000" opacity={0.5} />
      <AxesGizmo alignment="bottom-left" margin={[72, 72]} axisColors={['#ff4060', '#40ff80', '#4080ff']} labelColor="white" />
      {/* The picker sizes each atom as the atom layer would (neutral 0.5 here:
          the frame declares no elements or units); a click at a projected
          centre hits it. */}
      <AtomPicker
        frame={frame}
        spatialHash={spatialHash}
        onSelect={(indices) => {
          selectedRef.current = indices;
        }}
      />
      {expected && <ScreenProbes expected={expected} onDeclared={() => releaseRef.current()} />}
    </>
  );
}
