import React from 'react';
import ReactThreeTestRenderer from '@react-three/test-renderer/webgpu';
import { useThree } from '@react-three/fiber/webgpu';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { Frame } from '@atlas/core/types';
import { ELEMENT_DATA } from '@atlas/core';
import { AtomPicker, pickAtomAtClient } from './AtomPicker';
import { SpatialHash3D } from './SpatialHash';
import { emitIntent, onIntent, registerCanvasInputSource } from './intents';

const WIDTH = 800;
const HEIGHT = 600;
const SI = 14;
const O = 8;

function frameOf(points: Array<[number, number, number]>, types: number[]): Frame {
  return {
    timestep: 0,
    natoms: points.length,
    boxBounds: new Float64Array([-10, 10, -10, 10, -10, 10]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
    columns: ['id', 'type', 'x', 'y', 'z'],
    ids: Int32Array.from(points, (_, i) => i + 1),
    types: Int32Array.from(types),
    typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
    distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
    positions: Float32Array.from(points.flat()),
    bonds: new Int32Array(0),
    properties: new Map(),
  };
}

type Live = { camera: THREE.Camera; canvas: HTMLCanvasElement };

/** Captures the R3F camera and canvas, and gives the canvas a real client rect. */
function Probe({ onLive }: { onLive: (live: Live) => void }) {
  const camera = useThree((state) => state.camera);
  const renderer = useThree((state) => state.renderer);
  React.useLayoutEffect(() => {
    const canvas = renderer.domElement as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({
      left: 0, top: 0, right: WIDTH, bottom: HEIGHT, width: WIDTH, height: HEIGHT, x: 0, y: 0, toJSON: () => ({}),
    });
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    camera.updateMatrixWorld();
    onLive({ camera, canvas });
  }, [camera, renderer, onLive]);
  return null;
}

function clientOf(camera: THREE.Camera, point: [number, number, number]): [number, number] {
  const v = new THREE.Vector3(...point).project(camera);
  return [((v.x + 1) / 2) * WIDTH, ((1 - v.y) / 2) * HEIGHT];
}

describe('<AtomPicker /> on the intent bus', () => {
  let unregister: () => void = () => {};
  const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  let previousAct: boolean | undefined;

  beforeEach(() => {
    previousAct = reactGlobal.IS_REACT_ACT_ENVIRONMENT;
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;
    unregister = registerCanvasInputSource();
  });
  afterEach(() => {
    unregister();
    reactGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
  });

  async function mount(frame: Frame) {
    const hash = new SpatialHash3D(3.0);
    hash.build(frame.positions, frame.natoms);
    let live: Live | null = null;
    const selections: number[][] = [];
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <Probe onLive={(value) => { live = value; }} />
        <AtomPicker frame={frame} spatialHash={hash} onSelect={(indices) => selections.push(indices)} />
      </>,
      { width: WIDTH, height: HEIGHT },
    );
    if (!live) throw new Error('no camera');
    return { renderer, live: live as Live, selections };
  }

  it('a tap on a core atom picks it, not the neighbour in front of it', async () => {
    // An O 1.61 Å in front of the Si, 0.9 Å off its line of sight (the old 2 Å bubble took the O).
    const frame = frameOf([[0, 0, 0], [0.9, 0, 1.335]], [SI, O]);
    const { renderer, live, selections } = await mount(frame);
    const [x, y] = clientOf(live.camera, [0, 0, 0]);
    await ReactThreeTestRenderer.act(async () => {
      emitIntent({ type: 'canvas.tap', clientX: x, clientY: y, pointerType: 'mouse', shiftKey: false });
    });
    expect(selections.at(-1)).toEqual([0]);
    // The toys pick by the same rule.
    expect(pickAtomAtClient(x, y, 'touch')).toBe(0);
    await renderer.unmount();
  });

  it('a double-tap keeps the first atom when the second lands within the pointer tolerance of it', async () => {
    // Two Si side by side, 1 Å apart: their silhouettes overlap.
    const frame = frameOf([[-0.5, 0, 0], [0.5, 0, 0]], [SI, SI]);
    const { renderer, live, selections } = await mount(frame);
    const focused: number[] = [];
    const off = onIntent('camera.focusAtom', ({ atomIndex }) => focused.push(atomIndex));
    const rho = (ELEMENT_DATA[SI].displayRadius * Math.abs(live.camera.projectionMatrix.elements[5]) * HEIGHT) / 2 / 10;
    const [ax, ay] = clientOf(live.camera, [-0.5, 0, 0]);
    // The second tap: on atom 1, 2 px outside atom 0's silhouette.
    const [bx] = clientOf(live.camera, [0.5, 0, 0]);
    const second = ax + rho + 2;
    expect(second).toBeGreaterThan(bx - rho);

    await ReactThreeTestRenderer.act(async () => {
      emitIntent({ type: 'canvas.tap', clientX: ax, clientY: ay, pointerType: 'touch', shiftKey: false });
      emitIntent({ type: 'canvas.doubleTap', clientX: second, clientY: ay, pointerType: 'touch' });
    });
    expect(selections.at(-1)).toEqual([0]);
    expect(focused).toEqual([0]);

    // A finger 20 px off is a second tap on the other atom, not a double-tap.
    const far = ax + rho + 20;
    expect(far).toBeLessThan(bx + rho);
    await ReactThreeTestRenderer.act(async () => {
      emitIntent({ type: 'canvas.tap', clientX: ax, clientY: ay, pointerType: 'touch', shiftKey: false });
      emitIntent({ type: 'canvas.doubleTap', clientX: far, clientY: ay, pointerType: 'touch' });
    });
    expect(selections.at(-1)).toEqual([1]);
    expect(focused).toEqual([0]);
    off();
    await renderer.unmount();
  });

  it('a tap on empty canvas clears the selection', async () => {
    const frame = frameOf([[0, 0, 0]], [SI]);
    const { renderer, live, selections } = await mount(frame);
    const [x, y] = clientOf(live.camera, [0, 0, 0]);
    await ReactThreeTestRenderer.act(async () => {
      emitIntent({ type: 'canvas.tap', clientX: x, clientY: y, pointerType: 'mouse', shiftKey: false });
      emitIntent({ type: 'canvas.tap', clientX: x + 200, clientY: y, pointerType: 'touch', shiftKey: false });
    });
    expect(selections).toEqual([[0], []]);
    await renderer.unmount();
  });
});
