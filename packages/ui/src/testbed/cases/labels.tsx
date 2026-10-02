/**
 * labels — the label layers (WP5): LupiText canvas-texture sprites, the
 * measurement line and label, annotations (glyph, halo, tag), knowledge
 * labels (glyph, card), selection rings and the atom-info card, over three
 * flat stand-in atoms (C, O, N).
 *
 * The case steps through one layer at a time. At each step it reads the
 * canvas back right after the frame and compares it with the atoms-only
 * capture around the layer's anchor (pixels changed, and the layer's own
 * colour present), or checks the DOM for the `Html` layers. It asserts:
 * - text: a label's fill colour is exact at its anchor (one sRGB decode and
 *   one encode); anchorX left / anchorY top place the block beside the
 *   anchor; a depth-tested label is hidden behind a nearer sphere, while
 *   depthTest={false} draws over it; the texture is sRGB, unmipmapped and
 *   64 px/em × min(devicePixelRatio, 3);
 * - measurement: the line colour on the line, the value label and the A/B
 *   letters; annotations glyph and halo; knowledge glyph; selection ring;
 * - DOM: the annotation tag, the knowledge card and the atom-info card
 *   (anchored on desktop, a docked sheet on phones) are in the page;
 * - orbit: after the camera orbits 60° about Y, the billboarded label still
 *   faces the camera and shows its fill colour at the anchor.
 * The final screenshot is the orbited view with every canvas layer; its
 * probes are the label anchor (exact fill) and the plate above it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import { Billboard } from '@react-three/drei/webgpu';
import * as THREE from 'three/webgpu';
import type { Frame } from '@atlas/core/types';
import { ELEMENT_DATA, resolveTypeDisplayRadius } from '@atlas/core';
import { LUPI_PHASE } from '@atlas/scene';
import { LABEL_LINE_HEIGHT, LABEL_MAX_PIXEL_RATIO, LABEL_PX_PER_EM, LupiText } from '../../labels/LupiText';
import { MeasurementLayer } from '../../MeasurementLayer';
import { AnnotationsLayer, type AnnotationItem } from '../../AnnotationsLayer';
import { KnowledgeLabelsLayer } from '../../KnowledgeLabelsLayer';
import { SelectionMarkers } from '../../SelectionMarkers';
import { AtomInfoHUD } from '../../AtomInfoHUD';
import { MOBILE_MEDIA_QUERY } from '../../hooks/useMediaQuery';
import type { MolecularMeasurement } from '../../measurements';
import type { KnowledgeLabel } from '../../store';
import { HARNESS_PLATE, harnessAssert, harnessHold, useHarnessProbe } from '../harness';

type Vec3 = [number, number, number];

/** Frames rendered at a step before it is judged. */
const SETTLE_FRAMES = 4;
/** Extra frames a DOM step may wait for drei's Html root to commit. */
const DOM_WAIT_FRAMES = 40;
const ORBIT_DEGREES = 60;
const PLATE_RGB: [number, number, number] = [16, 24, 23];

const ATOMS: Array<{ position: Vec3; type: number }> = [
  { position: [-0.7, -0.45, 0], type: 6 },
  { position: [0.7, -0.45, 0], type: 8 },
  { position: [0, -1.2, 0], type: 7 },
];
const STAND_IN_RADIUS = 0.12;

/** Solid blocks, so the anchor pixel is inside the glyphs whatever the font. */
const BLOCKS = '███';
const PROBE_LABEL: Vec3 = [0, 1.7, 0];
const PROBE_FILL = '#d5ef9c';
const LEFT_LABEL: Vec3 = [-0.55, 1.05, 0];
const TOP_LABEL: Vec3 = [0.55, 1.2, 0];
const ANCHOR_FONT = 0.2;
const DEPTH_FONT = 0.3;
const DEPTH_LABEL: Vec3 = [-0.5, 0.35, 0];
const NO_DEPTH_LABEL: Vec3 = [0.5, 0.35, 0];
/** Occluders sit on the camera ray to each depth label, 0.8 in front of it. */
const OCCLUDER_T = 0.16;
const OCCLUDER_RADIUS = 0.1;
const OCCLUDER_COLOR = '#808080';

const MEASUREMENT: MolecularMeasurement = {
  kind: 'distance',
  capturedFrame: 0,
  atoms: [
    { identity: 'frame-row', row: 0, frame: 0 },
    { identity: 'frame-row', row: 1, frame: 0 },
  ],
};
const ANNOTATION_GLYPH: AnnotationItem[] = [{ id: 'tb-glyph', atomIndex: 2, text: 'glyph', createdAt: 0 }];
const ANNOTATION_HALO: AnnotationItem[] = [{ id: 'tb-halo', atomIndex: 2, text: 'halo', createdAt: 0 }];
const TAG_TEXT = 'testbed tag';
const ANNOTATION_TAG: AnnotationItem[] = [{ id: 'tb-tag', atomIndex: 0, text: TAG_TEXT, createdAt: 0 }];
const KNOWLEDGE_GLYPH: KnowledgeLabel[] = [{ id: 'tb-kg', kind: 'node', text: 'KG', salience: 2, position: [0, -1, 0] }];
const CARD_TEXT = 'testbed card';
const KNOWLEDGE_CARD: KnowledgeLabel[] = [
  { id: 'tb-kg-card', kind: 'node', text: CARD_TEXT, detail: 'knowledge', salience: 2, position: [0, -1, 0] },
];
const NODE_KINDS = new Set(['node']);

type StepId =
  | 'base'
  | 'text'
  | 'measurement'
  | 'annotation-glyph'
  | 'annotation-halo'
  | 'annotation-tag'
  | 'knowledge-glyph'
  | 'knowledge-card'
  | 'selection'
  | 'hud'
  | 'orbit';

const STEPS: StepId[] = [
  'base',
  'text',
  'measurement',
  'annotation-glyph',
  'annotation-halo',
  'annotation-tag',
  'knowledge-glyph',
  'knowledge-card',
  'selection',
  'hud',
  'orbit',
];
const DOM_STEPS = new Set<StepId>(['annotation-tag', 'knowledge-card', 'hud']);

interface Capture {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

function makeFrame(): Frame {
  const positions = new Float32Array(ATOMS.flatMap((atom) => atom.position));
  return {
    timestep: 0,
    natoms: ATOMS.length,
    boxBounds: new Float64Array([-3, 3, -3, 3, -3, 3]),
    boxTilt: new Float64Array(3),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: Int32Array.from(ATOMS, (_, index) => index + 1),
    types: Int32Array.from(ATOMS, (atom) => atom.type),
    typeSemantics: { kind: 'atomic-number', provenance: 'procedural-symbol' },
    distanceSemantics: { kind: 'angstrom', provenance: 'procedural' },
    positions,
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

function captureCanvas(source: HTMLCanvasElement, scratch: HTMLCanvasElement): Capture {
  scratch.width = source.width;
  scratch.height = source.height;
  const context = scratch.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2D context for the capture');
  context.clearRect(0, 0, source.width, source.height);
  context.drawImage(source, 0, 0);
  return { width: source.width, height: source.height, data: context.getImageData(0, 0, source.width, source.height).data };
}

function rgbOf(color: string): [number, number, number] {
  const c = new THREE.Color(color);
  const hex = c.getHex();
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Capture pixel of a world point. */
function toPixel(world: Vec3, camera: THREE.Camera, c: Capture): [number, number] {
  const p = new THREE.Vector3(...world).project(camera);
  return [Math.round(((p.x + 1) / 2) * c.width), Math.round(((1 - p.y) / 2) * c.height)];
}

function pixelAt(c: Capture, x: number, y: number): [number, number, number] {
  const cx = Math.min(c.width - 1, Math.max(0, x));
  const cy = Math.min(c.height - 1, Math.max(0, y));
  const i = (cy * c.width + cx) * 4;
  return [c.data[i], c.data[i + 1], c.data[i + 2]];
}

function near(a: readonly number[], b: readonly number[], tol: number): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
}

/** Pixel of a world point must match `rgb` within `tol`. */
function expectPixel(name: string, c: Capture, camera: THREE.Camera, world: Vec3, rgb: readonly number[], tol: number): void {
  const [x, y] = toPixel(world, camera, c);
  const got = pixelAt(c, x, y);
  harnessAssert(name, near(got, rgb, tol), `(${x},${y}) rgb=${got.join(',')} expect ${rgb.join(',')} ±${tol}`);
}

interface WindowStats {
  changed: number;
  colored: number;
}

/** Pixels in a world-space box (centre ± half extents, in the z=centre plane) that changed, and that match `rgb`. */
function windowStats(c: Capture, base: Capture, camera: THREE.Camera, center: Vec3, half: [number, number], rgb: readonly number[], tol: number): WindowStats {
  const [x0, y0] = toPixel([center[0] - half[0], center[1] + half[1], center[2]], camera, c);
  const [x1, y1] = toPixel([center[0] + half[0], center[1] - half[1], center[2]], camera, c);
  let changed = 0;
  let colored = 0;
  for (let y = Math.max(0, Math.min(y0, y1)); y <= Math.min(c.height - 1, Math.max(y0, y1)); y += 1) {
    for (let x = Math.max(0, Math.min(x0, x1)); x <= Math.min(c.width - 1, Math.max(x0, x1)); x += 1) {
      const i = (y * c.width + x) * 4;
      const px = [c.data[i], c.data[i + 1], c.data[i + 2]];
      const was = [base.data[i], base.data[i + 1], base.data[i + 2]];
      if (!near(px, was, 20)) changed += 1;
      if (near(px, rgb, tol)) colored += 1;
    }
  }
  return { changed, colored };
}

function expectLayer(
  name: string,
  c: Capture,
  base: Capture,
  camera: THREE.Camera,
  center: Vec3,
  half: [number, number],
  color: string | readonly number[],
  minChanged: number,
): void {
  const rgb = typeof color === 'string' ? rgbOf(color) : color;
  const stats = windowStats(c, base, camera, center, half, rgb, 40);
  harnessAssert(
    name,
    stats.changed >= minChanged && stats.colored >= 3,
    `changed=${stats.changed} (min ${minChanged}) pixels of ${rgb.join(',')}±40=${stats.colored} (min 3)`,
  );
}

function findLabel(scene: THREE.Object3D, text: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  scene.traverse((object) => {
    if (!found && object.name === 'lupi-text' && object.userData.lupiText === text) found = object as THREE.Mesh;
  });
  return found;
}

function visibleElement(predicate: (element: HTMLElement) => boolean): HTMLElement | null {
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('div'))) {
    if (!predicate(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight) return element;
  }
  return null;
}

/** Flat stand-in atoms (MeshBasicNodeMaterial in element colours). */
function StandInAtoms() {
  const materials = useMemo(
    () => ATOMS.map((atom) => new THREE.MeshBasicNodeMaterial({ color: ELEMENT_DATA[atom.type].color })),
    [],
  );
  useEffect(() => () => materials.forEach((material) => material.dispose()), [materials]);
  return (
    <group>
      {ATOMS.map((atom, index) => (
        <mesh key={index} position={atom.position} material={materials[index]}>
          <sphereGeometry args={[STAND_IN_RADIUS, 24, 12]} />
        </mesh>
      ))}
    </group>
  );
}

function occluderPosition(label: Vec3): Vec3 {
  // On the segment from the label to the camera at [0, 0, 5].
  return [label[0] * (1 - OCCLUDER_T), label[1] * (1 - OCCLUDER_T), label[2] * (1 - OCCLUDER_T) + 5 * OCCLUDER_T];
}

/** LupiText directly: fill colour, anchors and depth. */
function TextRows() {
  const occluder = useMemo(() => new THREE.MeshBasicNodeMaterial({ color: OCCLUDER_COLOR }), []);
  useEffect(() => () => occluder.dispose(), [occluder]);
  return (
    <group>
      <Billboard position={PROBE_LABEL}>
        <LupiText fontSize={0.3} color={PROBE_FILL} anchorX="center" anchorY="middle">{BLOCKS}</LupiText>
      </Billboard>
      <Billboard position={LEFT_LABEL}>
        <LupiText fontSize={ANCHOR_FONT} color="#f9a8d4" anchorX="left" anchorY="middle">{BLOCKS}</LupiText>
      </Billboard>
      <Billboard position={TOP_LABEL}>
        <LupiText fontSize={ANCHOR_FONT} color="#c4b5fd" anchorX="center" anchorY="top">{'█'}</LupiText>
      </Billboard>
      <Billboard position={DEPTH_LABEL}>
        <LupiText fontSize={DEPTH_FONT} color="#93c5fd" anchorX="center" anchorY="middle">{BLOCKS}</LupiText>
      </Billboard>
      <Billboard position={NO_DEPTH_LABEL}>
        <LupiText fontSize={DEPTH_FONT} color="#fcd34d" anchorX="center" anchorY="middle" depthTest={false} renderOrder={10}>
          {BLOCKS}
        </LupiText>
      </Billboard>
      <mesh position={occluderPosition(DEPTH_LABEL)} material={occluder}>
        <sphereGeometry args={[OCCLUDER_RADIUS, 24, 12]} />
      </mesh>
      <mesh position={occluderPosition(NO_DEPTH_LABEL)} material={occluder}>
        <sphereGeometry args={[OCCLUDER_RADIUS, 24, 12]} />
      </mesh>
    </group>
  );
}

function judgeText(c: Capture, camera: THREE.Camera, scene: THREE.Object3D): void {
  expectPixel('label fill colour is exact at its anchor', c, camera, PROBE_LABEL, rgbOf(PROBE_FILL), 3);
  const em = ANCHOR_FONT;
  expectPixel('anchorX left: the text starts at the anchor', c, camera, [LEFT_LABEL[0] + 0.6 * em, LEFT_LABEL[1], 0], rgbOf('#f9a8d4'), 6);
  expectPixel('anchorX left: nothing left of the anchor', c, camera, [LEFT_LABEL[0] - 0.4 * em, LEFT_LABEL[1], 0], PLATE_RGB, 6);
  expectPixel('anchorY top: the text hangs below the anchor', c, camera, [TOP_LABEL[0], TOP_LABEL[1] - 0.6 * em, 0], rgbOf('#c4b5fd'), 6);
  expectPixel('anchorY top: nothing above the anchor', c, camera, [TOP_LABEL[0], TOP_LABEL[1] + 0.4 * em, 0], PLATE_RGB, 6);
  expectPixel('a depth-tested label is hidden behind a nearer sphere', c, camera, DEPTH_LABEL, rgbOf(OCCLUDER_COLOR), 3);
  expectPixel(
    'the depth-tested label shows beside the sphere',
    c,
    camera,
    [DEPTH_LABEL[0] + 0.45 * DEPTH_FONT, DEPTH_LABEL[1] + 0.4 * DEPTH_FONT, 0],
    rgbOf('#93c5fd'),
    6,
  );
  expectPixel('depthTest={false} draws the label over the sphere', c, camera, NO_DEPTH_LABEL, rgbOf('#fcd34d'), 3);

  const mesh = findLabel(scene, BLOCKS);
  const material = mesh?.material as THREE.MeshBasicNodeMaterial | undefined;
  const map = material?.map as THREE.CanvasTexture | null | undefined;
  const image = map?.image as HTMLCanvasElement | undefined;
  const pxPerEm = LABEL_PX_PER_EM * Math.min(Math.max(window.devicePixelRatio || 1, 1), LABEL_MAX_PIXEL_RATIO);
  const expectedHeight = Math.ceil(LABEL_LINE_HEIGHT * pxPerEm + 4);
  harnessAssert(
    'label texture: sRGB, no mipmaps, 64 px/em × min(DPR, 3)',
    Boolean(map) &&
      map!.colorSpace === THREE.SRGBColorSpace &&
      map!.generateMipmaps === false &&
      image?.height === expectedHeight,
    `colorSpace=${map?.colorSpace} mipmaps=${map?.generateMipmaps} height=${image?.height} expected=${expectedHeight}`,
  );
}

function judgeDom(step: StepId): boolean {
  if (step === 'annotation-tag') {
    const tag = visibleElement((element) => element.textContent === TAG_TEXT && element.childElementCount === 0);
    if (!tag) return false;
    harnessAssert('annotation tag (Html) is in the page', true);
    return true;
  }
  if (step === 'knowledge-card') {
    const card = visibleElement((element) => element.textContent === CARD_TEXT && element.childElementCount === 0);
    if (!card) return false;
    harnessAssert('knowledge card (Html) is in the page', true);
    return true;
  }
  const card = document.querySelector<HTMLElement>('[data-testid="atom-info-card"]');
  if (!card || card.getBoundingClientRect().width === 0) return false;
  const phone = window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  const rect = card.getBoundingClientRect();
  harnessAssert(
    'atom-info card (Html) shows the picked atom',
    card.getAttribute('data-atom-index') === '0' && (card.textContent ?? '').includes(ELEMENT_DATA[6].name),
    `index=${card.getAttribute('data-atom-index')} text=${(card.textContent ?? '').slice(0, 60)}`,
  );
  harnessAssert(
    `atom-info card layout is ${phone ? 'the docked sheet' : 'anchored'}`,
    card.getAttribute('data-layout') === (phone ? 'sheet' : 'anchored') && rect.top >= 0 && rect.top < window.innerHeight,
    `layout=${card.getAttribute('data-layout')} rect=${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
  );
  return true;
}

export default function LabelsCase() {
  const frame = useMemo(makeFrame, []);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const run = useRef({ frames: 0, pending: false, done: false, base: null as Capture | null });
  const scratch = useMemo(() => document.createElement('canvas'), []);
  const release = useRef<() => void>(() => {});
  const camera = useThree((state) => state.camera);
  const step = STEPS[index];

  useHarnessProbe('label anchor (after the orbit)', PROBE_LABEL, { rgb: rgbOf(PROBE_FILL), tol: 4 });
  useHarnessProbe('plate above the label', [PROBE_LABEL[0], PROBE_LABEL[1] + 0.45, 0], 'plate');

  useEffect(() => {
    release.current = harnessHold('labels sequence');
    return () => release.current();
  }, []);

  useLayoutEffect(() => {
    indexRef.current = index;
    run.current.frames = 0;
    run.current.pending = false;
    if (STEPS[index] === 'orbit') {
      const angle = THREE.MathUtils.degToRad(ORBIT_DEGREES);
      camera.position.set(5 * Math.sin(angle), 0, 5 * Math.cos(angle));
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();
    }
  }, [index, camera]);

  useFrame(
    (state) => {
      const r = run.current;
      if (r.done || r.pending) return;
      r.frames += 1;
      const current = STEPS[indexRef.current];
      if (r.frames < SETTLE_FRAMES) return;
      const dpr = state.renderer.domElement.width / Math.max(1, state.size.width);
      const minChanged = Math.round(12 * dpr * dpr);
      try {
        if (DOM_STEPS.has(current)) {
          if (!judgeDom(current)) {
            if (r.frames < SETTLE_FRAMES + DOM_WAIT_FRAMES) return;
            harnessAssert(`${current}: Html element is in the page`, false, `not found after ${r.frames} frames`);
          }
        } else {
          const c = captureCanvas(state.renderer.domElement, scratch);
          const base = r.base;
          if (current === 'base') {
            r.base = c;
            expectPixel('stand-in atom renders', c, state.camera, ATOMS[0].position, rgbOf(ELEMENT_DATA[6].color), 3);
          } else if (!base) {
            throw new Error('no atoms-only capture');
          } else if (current === 'text') {
            judgeText(c, state.camera, state.scene);
          } else if (current === 'measurement') {
            const [a, b] = ATOMS;
            const mid: Vec3 = [(a.position[0] + b.position[0]) / 2, a.position[1], 0];
            const quarter: Vec3 = [(3 * a.position[0] + b.position[0]) / 4, a.position[1], 0];
            const [qx, qy] = toPixel(quarter, state.camera, c);
            const line = rgbOf('#fbbf24');
            let best = Number.POSITIVE_INFINITY;
            for (let dy = -2; dy <= 2; dy += 1) {
              const got = pixelAt(c, qx, qy + dy);
              best = Math.min(best, Math.max(...got.map((value, channel) => Math.abs(value - line[channel]))));
            }
            harnessAssert('measurement line shows its colour', best <= 30, `closest channel error ${best} at (${qx},${qy}±2)`);
            expectLayer('measurement value label draws at the midpoint', c, base, state.camera, mid, [0.35, 0.1], '#fff7d6', minChanged);
            const letterY = a.position[1] + 0.16 * 1.3;
            expectLayer('measurement letter A draws above its atom', c, base, state.camera, [a.position[0], letterY, 0], [0.1, 0.08], '#fbbf24', Math.round(minChanged / 3));
            expectLayer('measurement letter B draws above its atom', c, base, state.camera, [b.position[0], letterY, 0], [0.1, 0.08], '#fbbf24', Math.round(minChanged / 3));
          } else if (current === 'annotation-glyph') {
            const atom = ATOMS[2].position;
            expectLayer('annotation glyph draws above its atom', c, base, state.camera, [atom[0], atom[1] + 1.6, 0], [0.8, 0.3], '#e6f0ff', minChanged);
          } else if (current === 'annotation-halo') {
            const atom = ATOMS[2].position;
            expectLayer('annotation halo draws around its atom', c, base, state.camera, atom, [1.6, 0.9], '#a8d8ff', minChanged);
          } else if (current === 'knowledge-glyph') {
            const p = KNOWLEDGE_GLYPH[0].position;
            expectLayer('knowledge glyph label draws above its point', c, base, state.camera, [p[0], p[1] + 1.4, 0], [0.5, 0.3], '#a0ffc8', minChanged);
          } else if (current === 'selection') {
            const atom = ATOMS[1];
            const radius = resolveTypeDisplayRadius(frame, atom.type) * 1.4;
            expectLayer('selection ring draws around the atom', c, base, state.camera, atom.position, [radius, radius], [114, 192, 229], minChanged);
          } else if (current === 'orbit') {
            expectPixel('after the orbit the label still shows its fill at the anchor', c, state.camera, PROBE_LABEL, rgbOf(PROBE_FILL), 4);
            const mesh = findLabel(state.scene, BLOCKS);
            let facing = Number.NaN;
            if (mesh) {
              // drei's Billboard copies the camera rotation: the label lies in the view plane.
              const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new THREE.Quaternion()));
              const backward = state.camera.getWorldDirection(new THREE.Vector3()).negate();
              facing = normal.dot(backward);
            }
            harnessAssert('after the orbit the billboarded label faces the camera', facing > 0.999, `normal·(−view direction)=${facing.toFixed(4)}`);
          }
        }
      } catch (error) {
        harnessAssert(`step ${current} runs`, false, String(error));
        r.done = true;
        release.current();
        return;
      }
      if (current === 'orbit') {
        r.done = true;
        harnessAssert('plate colour', true, HARNESS_PLATE);
        release.current();
        return;
      }
      r.pending = true;
      setIndex((value) => value + 1);
    },
    { phase: LUPI_PHASE.capture, id: 'lupi/testbed-labels' },
  );

  const orbit = step === 'orbit';
  return (
    <>
      <StandInAtoms />
      {(step === 'text' || orbit) && <TextRows />}
      {(step === 'measurement' || orbit) && <MeasurementLayer frame={frame} frameIndex={0} measurement={MEASUREMENT} />}
      {(step === 'annotation-glyph' || orbit) && <AnnotationsLayer frame={frame} annotations={ANNOTATION_GLYPH} style="glyph" />}
      {(step === 'annotation-halo' || orbit) && <AnnotationsLayer frame={frame} annotations={ANNOTATION_HALO} style="halo" />}
      {step === 'annotation-tag' && <AnnotationsLayer frame={frame} annotations={ANNOTATION_TAG} style="tag" />}
      {(step === 'knowledge-glyph' || orbit) && <KnowledgeLabelsLayer labels={KNOWLEDGE_GLYPH} visibleKinds={NODE_KINDS} style="glyph" />}
      {step === 'knowledge-card' && <KnowledgeLabelsLayer labels={KNOWLEDGE_CARD} visibleKinds={NODE_KINDS} />}
      {(step === 'selection' || orbit) && <SelectionMarkers frame={frame} selectedAtoms={[1]} hoveredAtom={null} />}
      {step === 'hud' && <AtomInfoHUD frame={frame} selectedAtoms={[0]} />}
    </>
  );
}
