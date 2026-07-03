// Scene components
export { AtomsOptimized } from './AtomsOptimized';
export { AtomClusters } from './AtomClusters';
export { buildClusters, MAX_GRID_DIM, clusterCellRadius } from './ClusterBuilder';
export type { Clusters } from './ClusterBuilder';
export { InterpolatedAtoms } from './InterpolatedAtoms';
export { SimulationCell } from './SimulationCell';
export { Bonds, DEFAULT_CUTOFFS, buildTypeCutoffs } from './Bonds';
export { useBondGpuPipeline } from './useBondGpuPipeline';
export type { BondGpuComputeInput, UseBondGpuPipelineResult } from './useBondGpuPipeline';
export { AtomPicker } from './AtomPicker';
export { SpatialHash3D } from './SpatialHash';
export { VectorGlyphs } from './VectorGlyphs';
export type { VectorGlyphStats } from './VectorGlyphs';
export {
  BillionAtomBlock,
  TOTAL_ATOMS as BILLION_BLOCK_TOTAL_ATOMS,
  ATOMS_PER_BRICK as BILLION_BLOCK_ATOMS_PER_BRICK,
} from './BillionAtomBlock';
export type { BillionAtomStats } from './BillionAtomBlock';

// Shared constants
export {
  TYPE_COLORS,
  DEFAULT_TYPE_COLOR,
  TYPE_RADII,
  COLORMAPS,
  getBackgroundFromColormap,
} from './constants';

// Types
export type { PickedAtom } from './AtomPicker';
