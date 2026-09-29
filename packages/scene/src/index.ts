// Scene components
export {
  AtomsOptimized,
  LUPI_APPLIED_ARTIFACT_SPEC_ID_KEY,
  LUPI_ARTIFACT_ATOMS_LAYER,
  LUPI_ARTIFACT_LAYER_KEY,
  QUALITY_TIER_FULL_ATOM_LIMIT,
  QUALITY_TIER_IBL_ATOM_LIMIT,
  resolveAtomQualityTier,
} from './AtomsOptimized';
export type { AtomQualityTier } from './AtomsOptimized';
export { computeAtomOcclusion, suggestOcclusionRadius } from './atomOcclusion';
export type { AtomOcclusionInput, AtomOcclusionResult } from './atomOcclusion';
export { useAtomOcclusion, useAtomClusters } from './useAtomOcclusion';
export {
  AtomsTransmission,
  MAX_TRANSMISSION_ATOMS,
  TRANSMISSION_BASE_ROUGHNESS,
  applyTransmissionInstanceMatrices,
  buildAtomSurfaceRoughnessMap,
  createAtomColorResolver,
  transmissionQuality,
  transmissionSphereDetail,
  transmissionStrength,
} from './AtomsTransmission';
export type {
  TransmissionInterpolationData,
  TransmissionQuality,
  TransmissionSphereDetail,
} from './AtomsTransmission';
export { AtomClusters } from './AtomClusters';
export { buildClusters, MAX_GRID_DIM, clusterCellRadius } from './ClusterBuilder';
export type { Clusters } from './ClusterBuilder';
export { SimulationCell } from './SimulationCell';
export { Bonds, DEFAULT_CUTOFFS, buildTypeCutoffs } from './Bonds';
export { resolveBondTopologyMode, validateSourceBondTopology } from './bondTopology';
export type { BondTopologyMode, SourceBondTopologyValidation } from './bondTopology';
export { useBondGpuPipeline } from './useBondGpuPipeline';
export type { BondGpuComputeInput, UseBondGpuPipelineResult } from './useBondGpuPipeline';
export { AtomPicker } from './AtomPicker';
export { SpatialHash3D } from './SpatialHash';
export { VectorGlyphs, LUPI_ARTIFACT_VECTOR_GLYPHS_LAYER } from './VectorGlyphs';
export type { VectorGlyphStats } from './VectorGlyphs';
export {
  BillionAtomBlock,
  TOTAL_ATOMS as BILLION_BLOCK_TOTAL_ATOMS,
  ATOMS_PER_BRICK as BILLION_BLOCK_ATOMS_PER_BRICK,
} from './BillionAtomBlock';
export type { BillionAtomStats } from './BillionAtomBlock';

// Frame phases (R3F v10 scheduler) and job ids
export { LUPI_PHASE, LUPI_JOB, installLupiPhases } from './framePhases';
export type { LupiPhase, LupiJobId } from './framePhases';

// The intent bus and the capture guards (wave-1 contracts)
export {
  emitIntent,
  onIntent,
  registerCanvasInputSource,
  isCanvasInputSourceActive,
  subscribeCanvasInputSource,
} from './intents';
export type { LupiIntent, LupiIntentOf, LupiIntentType, PointerKind } from './intents';
export {
  registerCaptureGuard,
  runPrepareCapture,
  beginCaptureRender,
  registerRecordingGuard,
  beginRecording,
} from './captureGuards';
export type { CaptureGuard } from './captureGuards';

// TSL: the node-material uniform bag and the impostor shading kit
export {
  LUPI_UNIFORMS_KEY,
  LUPI_SHADER_TAG_KEY,
  attachLupiUniforms,
  getLupiUniforms,
  readLupiUniform,
} from './tsl/lupiUniforms';
export type { LupiUniformBag } from './tsl/lupiUniforms';
export {
  analyticEnvironment,
  cappedCylinderNormal,
  createLupiEnvBinding,
  createLupiLightUniforms,
  depthFromViewZ,
  impostorDepthPrelude,
  lightDirection,
  lupiSurface,
  orthographicFlag,
  rayCappedCylinder,
  raySphere,
  syncLupiEnvBinding,
  viewRay,
} from './tsl/impostorKit';
export type { LupiEnvBinding, LupiLightUniforms, LupiSurfaceInput } from './tsl/impostorKit';
export * from './tsl/displayMotion';

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
