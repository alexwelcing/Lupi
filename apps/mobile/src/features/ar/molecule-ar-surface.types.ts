import type { MoleculeArAtom, MoleculeArScene } from "./ar-scene";

export type MoleculeArTrackingState =
  | "initializing"
  | "limited"
  | "normal"
  | "unavailable";

export interface MoleculeArSurfaceState {
  placed: boolean;
  planeCount: number;
  tracking: MoleculeArTrackingState;
}

export interface MoleculeArSurfaceProps {
  onAtomSelected: (atom: MoleculeArAtom) => void;
  onError: (message: string) => void;
  onStateChange: (state: MoleculeArSurfaceState) => void;
  resetToken: number;
  scene: MoleculeArScene;
  selectedAtomIndices: number[];
}
