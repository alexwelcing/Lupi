import { getAtomicNumberBySymbol } from '@atlas/core';
import type { AtomTypeSemantics, Frame, Trajectory } from '@atlas/core/types';
import type { LoadedFile } from './store';

const MLIP_MEASURED_FRAME_RATE = 1;

export type MlipArtifactPayload = EquilibriumScoreArtifact | MdTrajectoryArtifact;

export interface EquilibriumScoreArtifact {
  schema: 'lupine.distill.equilibrium_solve_score.v1';
  run_id?: string;
  cell_id?: string;
  variant_id?: string;
  mlip_id?: string;
  material_id: string;
  score?: Record<string, unknown>;
  anytime_curve?: Array<Record<string, unknown>>;
  viewer_artifact: {
    schema: 'lupine.mlip.equilibrium_viewer.v1';
    material_id: string;
    mlip_id?: string;
    frames: ViewerFrame[];
  };
}

export interface MdTrajectoryArtifact {
  schema: 'lupine.mlip.md_trajectory.v1';
  run_id?: string;
  cell_id?: string;
  variant_id?: string;
  mlip_id?: string;
  material_id: string;
  frames: ViewerFrame[];
  diagnostics?: Record<string, unknown>;
}

interface ViewerFrame {
  step?: number;
  time_seconds?: number;
  cell_angstrom?: number[][];
  positions_angstrom?: number[][];
  force_max_norm_ev_per_angstrom?: number;
  distance_to_reference?: number;
  closeness?: number;
  energy_ev_per_atom?: number;
  total_energy_ev_per_atom?: number;
  temperature_k?: number;
  symbols?: string[];
}

export function artifactToLoadedFile(payload: MlipArtifactPayload, sourceUrl: string): LoadedFile {
  if (payload.schema === 'lupine.distill.equilibrium_solve_score.v1') {
    return equilibriumScoreToLoadedFile(payload, sourceUrl);
  }
  if (payload.schema === 'lupine.mlip.md_trajectory.v1') {
    return mdTrajectoryToLoadedFile(payload, sourceUrl);
  }
  throw new Error(`Unsupported MLIP artifact schema: ${(payload as { schema?: string }).schema ?? 'unknown'}`);
}

function equilibriumScoreToLoadedFile(payload: EquilibriumScoreArtifact, sourceUrl: string): LoadedFile {
  const frames = viewerFramesToFrames(payload.viewer_artifact.frames, payload.material_id);
  return {
    name: `${payload.material_id} ${payload.mlip_id ?? 'MLIP'} measured solve`,
    size: frames.reduce((sum, frame) => sum + frame.positions.byteLength, 0),
    trajectory: framesToTrajectory(frames),
    thermo: null,
    sourceUrl,
  };
}

function mdTrajectoryToLoadedFile(payload: MdTrajectoryArtifact, sourceUrl: string): LoadedFile {
  const frames = viewerFramesToFrames(payload.frames, payload.material_id);
  const variant = payload.variant_id ? ` ${payload.variant_id.replaceAll('_', ' ')}` : '';
  return {
    name: `${payload.material_id} ${payload.mlip_id ?? 'MLIP'}${variant} measured MD`,
    size: frames.reduce((sum, frame) => sum + frame.positions.byteLength, 0),
    trajectory: framesToTrajectory(frames),
    thermo: null,
    sourceUrl,
    playbackFrameRate: MLIP_MEASURED_FRAME_RATE,
  };
}

function viewerFramesToFrames(viewerFrames: ViewerFrame[], materialId: string): Frame[] {
  if (!viewerFrames.length) throw new Error('Measured artifact has no frames.');
  const finalPositions = lastPositions(viewerFrames);
  const typings = viewerFrames.map((viewerFrame, frameIndex) => {
    const natoms = viewerFrame.positions_angstrom?.length ?? 0;
    return resolveMlipTyping(viewerFrame, materialId, natoms, frameIndex);
  });
  const stableSourceOrder = typings.every((typing, frameIndex) => (
    frameIndex === 0 || sameAtomicNumberOrder(typings[0].types, typing.types)
  ));

  return viewerFrames.map((viewerFrame, frameIndex) => {
    const positionsList = viewerFrame.positions_angstrom;
    if (!positionsList?.length) throw new Error('Measured viewer frame is missing positions_angstrom.');
    const natoms = positionsList.length;
    const typing = typings[frameIndex];
    const positions = new Float32Array(natoms * 3);
    const distanceToFinal = new Float32Array(natoms);
    const solveCloseness = new Float32Array(natoms);
    const forceNorm = new Float32Array(natoms);
    const globalDistance = typeof viewerFrame.distance_to_reference === 'number'
      ? viewerFrame.distance_to_reference
      : 0;
    const closeness = typeof viewerFrame.closeness === 'number' ? viewerFrame.closeness : 1 / (1 + globalDistance);
    const maxForce = typeof viewerFrame.force_max_norm_ev_per_angstrom === 'number'
      ? viewerFrame.force_max_norm_ev_per_angstrom
      : 0;

    for (let idx = 0; idx < natoms; idx += 1) {
      const pos = positionsList[idx];
      if (!pos || pos.length < 3 || !pos.slice(0, 3).every(Number.isFinite)) {
        throw new Error(`Measured viewer frame ${frameIndex} has an invalid position at atom ${idx}.`);
      }
      positions[idx * 3] = pos[0];
      positions[idx * 3 + 1] = pos[1];
      positions[idx * 3 + 2] = pos[2];
      const final = finalPositions[idx] ?? pos;
      distanceToFinal[idx] = distance3(pos, final);
      solveCloseness[idx] = closeness;
      forceNorm[idx] = maxForce;
    }

    const bounds = cellToBounds(viewerFrame.cell_angstrom, positions);
    return {
      timestep: Number(viewerFrame.step) || 0,
      natoms,
      boxBounds: bounds.boxBounds,
      boxTilt: bounds.boxTilt,
      triclinic: bounds.triclinic,
      columns: ['id', 'type', 'x', 'y', 'z', 'distance_to_final', 'solve_closeness', 'force_norm'],
      ids: Int32Array.from({ length: natoms }, (_, idx) => idx + 1),
      identity: stableSourceOrder
        ? { kind: 'source-order', unique: true }
        : { kind: 'synthetic-row', unique: true },
      types: typing.types,
      typeSemantics: typing.semantics,
      distanceSemantics: { kind: 'angstrom', provenance: 'source-declared' },
      positions,
      bonds: new Int32Array(0),
      properties: new Map([
        ['distance_to_final', distanceToFinal],
        ['solve_closeness', solveCloseness],
        ['force_norm', forceNorm],
      ]),
    };
  });
}

function framesToTrajectory(frames: Frame[]): Trajectory {
  return {
    frames,
    totalFrames: frames.length,
    atomTypes: Array.from(new Set(Array.from(frames[0]?.types ?? []))),
    globalBounds: boundsForFrames(frames),
  };
}

function lastPositions(frames: ViewerFrame[]): number[][] {
  return frames
    .slice()
    .reverse()
    .find((frame) => frame.positions_angstrom?.length)
    ?.positions_angstrom ?? [];
}

function cellToBounds(cell: number[][] | undefined, positions: Float32Array) {
  if (cell?.length === 3) {
    const x = Math.max(vectorLength(cell[0]), 1);
    const y = Math.max(vectorLength(cell[1]), 1);
    const z = Math.max(vectorLength(cell[2]), 1);
    const triclinic = Math.abs(cell[1]?.[0] ?? 0) > 1e-5
      || Math.abs(cell[2]?.[0] ?? 0) > 1e-5
      || Math.abs(cell[2]?.[1] ?? 0) > 1e-5;
    return {
      boxBounds: new Float64Array([0, x, 0, y, 0, z]),
      boxTilt: new Float64Array([cell[1]?.[0] ?? 0, cell[2]?.[0] ?? 0, cell[2]?.[1] ?? 0]),
      triclinic,
    };
  }
  const bounds = boundsForPositions(positions);
  return {
    boxBounds: new Float64Array([
      bounds.min[0],
      bounds.max[0],
      bounds.min[1],
      bounds.max[1],
      bounds.min[2],
      bounds.max[2],
    ]),
    boxTilt: new Float64Array([0, 0, 0]),
    triclinic: false,
  };
}

function boundsForFrames(frames: Frame[]): { min: [number, number, number]; max: [number, number, number] } {
  const bounds = frames.reduce(
    (acc, frame) => mergeBounds(acc, boundsForPositions(frame.positions)),
    emptyBounds(),
  );
  return finiteBounds(bounds);
}

function boundsForPositions(positions: Float32Array) {
  const bounds = emptyBounds();
  for (let idx = 0; idx < positions.length; idx += 3) {
    bounds.min[0] = Math.min(bounds.min[0], positions[idx]);
    bounds.min[1] = Math.min(bounds.min[1], positions[idx + 1]);
    bounds.min[2] = Math.min(bounds.min[2], positions[idx + 2]);
    bounds.max[0] = Math.max(bounds.max[0], positions[idx]);
    bounds.max[1] = Math.max(bounds.max[1], positions[idx + 1]);
    bounds.max[2] = Math.max(bounds.max[2], positions[idx + 2]);
  }
  return finiteBounds(bounds);
}

function emptyBounds() {
  return {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY] as [number, number, number],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY] as [number, number, number],
  };
}

function mergeBounds(left: ReturnType<typeof emptyBounds>, right: ReturnType<typeof emptyBounds>) {
  return {
    min: [
      Math.min(left.min[0], right.min[0]),
      Math.min(left.min[1], right.min[1]),
      Math.min(left.min[2], right.min[2]),
    ] as [number, number, number],
    max: [
      Math.max(left.max[0], right.max[0]),
      Math.max(left.max[1], right.max[1]),
      Math.max(left.max[2], right.max[2]),
    ] as [number, number, number],
  };
}

function finiteBounds(bounds: ReturnType<typeof emptyBounds>) {
  if (!bounds.min.every(Number.isFinite) || !bounds.max.every(Number.isFinite)) {
    return { min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
  }
  return bounds;
}

function resolveMlipTyping(
  frame: ViewerFrame,
  materialId: string,
  natoms: number,
  frameIndex: number,
): { types: Int32Array; semantics: AtomTypeSemantics } {
  if (natoms < 1) {
    throw new Error(`Measured viewer frame ${frameIndex} is missing positions_angstrom.`);
  }

  if (frame.symbols !== undefined) {
    if (frame.symbols.length !== natoms) {
      throw new Error(
        `Measured viewer frame ${frameIndex} has ${frame.symbols.length} symbols for ${natoms} atoms.`,
      );
    }
    const types = Int32Array.from(frame.symbols.map((symbol, atomIndex) => {
      const atomicNumber = getAtomicNumberBySymbol(symbol);
      if (atomicNumber === undefined) {
        throw new Error(
          `Measured viewer frame ${frameIndex} has unsupported element symbol "${symbol}" at atom ${atomIndex}.`,
        );
      }
      return atomicNumber;
    }));
    return {
      types,
      semantics: { kind: 'atomic-number', provenance: 'mlip-symbol' },
    };
  }

  const inferredAtomicNumber = singleElementAtomicNumber(materialId);
  if (inferredAtomicNumber === undefined) {
    throw new Error(
      `Measured viewer frame ${frameIndex} is missing per-atom symbols and material_id "${materialId}" is not an unambiguous single element.`,
    );
  }
  return {
    types: new Int32Array(natoms).fill(inferredAtomicNumber),
    semantics: { kind: 'atomic-number', provenance: 'mlip-material-id-inferred' },
  };
}

function singleElementAtomicNumber(materialId: string): number | undefined {
  const symbols = materialId.match(/[A-Z][a-z]?/g) ?? [];
  const atomicNumbers = new Set<number>();
  for (const symbol of symbols) {
    const atomicNumber = getAtomicNumberBySymbol(symbol);
    if (atomicNumber !== undefined) atomicNumbers.add(atomicNumber);
  }
  return atomicNumbers.size === 1 ? atomicNumbers.values().next().value : undefined;
}

function sameAtomicNumberOrder(left: Int32Array, right: Int32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function vectorLength(value: number[] | undefined) {
  if (!value) return 0;
  return Math.sqrt((value[0] ?? 0) ** 2 + (value[1] ?? 0) ** 2 + (value[2] ?? 0) ** 2);
}

function distance3(a: number[], b: number[]) {
  const dx = (Number(a[0]) || 0) - (Number(b[0]) || 0);
  const dy = (Number(a[1]) || 0) - (Number(b[1]) || 0);
  const dz = (Number(a[2]) || 0) - (Number(b[2]) || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
