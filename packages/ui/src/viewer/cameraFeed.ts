/**
 * The viewer's camera, as matrices, for anything drawn over the viewer that
 * has to line up with it. `CameraTap` sits in the React Three Fiber tree
 * and copies the camera every frame; readers take a snapshot and, when they
 * work in a normalised space, ask for the view-projection into that space.
 */
import { useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';

export interface CameraSnapshot {
  /** Column-major world → clip. */
  viewProjection: Float32Array;
  /** Camera position in world units. */
  eye: [number, number, number];
  aspect: number;
  /** Counts up each frame the camera was copied. */
  version: number;
}

const snapshot: CameraSnapshot = { viewProjection: new Float32Array(16), eye: [0, 0, 50], aspect: 1, version: 0 };

export function cameraSnapshot(): CameraSnapshot {
  return snapshot;
}

/** Column-major 4×4 multiply: out = a × b. */
function multiply(a: ArrayLike<number>, b: ArrayLike<number>, out: Float32Array): Float32Array {
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/**
 * The camera's view-projection into a space where world = normalised ×
 * scale + centre, and the eye in that space. For an engine that draws a
 * centred, unit-ish object where the viewer draws its molecule.
 */
export function cameraInto(centre: [number, number, number], scale: number, out = new Float32Array(16)): { viewProjection: Float32Array; eye: [number, number, number] } {
  const model = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, centre[0], centre[1], centre[2], 1];
  multiply(snapshot.viewProjection, model, out);
  const eye: [number, number, number] = [(snapshot.eye[0] - centre[0]) / scale, (snapshot.eye[1] - centre[1]) / scale, (snapshot.eye[2] - centre[2]) / scale];
  return { viewProjection: out, eye };
}

/** Mount inside the viewer's canvas; copies the camera each rendered frame. */
export function CameraTap() {
  const { camera, size } = useThree();
  useFrame(() => {
    const perspective = camera as PerspectiveCamera;
    perspective.updateMatrixWorld();
    multiply(perspective.projectionMatrix.elements, perspective.matrixWorldInverse.elements, snapshot.viewProjection);
    snapshot.eye = [perspective.position.x, perspective.position.y, perspective.position.z];
    snapshot.aspect = size.width / Math.max(size.height, 1);
    snapshot.version += 1;
  });
  return null;
}
