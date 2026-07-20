// ═══════════════════════════════════════════════════════════════════
// glimPSE — Core Exports
// ═══════════════════════════════════════════════════════════════════

export type {
  UnitStyle,
  Frame,
  FrameIdentity,
  FrameIdentityKind,
  AtomTypeSemantics,
  DistanceSemantics,
  Trajectory,
  TrajectoryResidency,
  ThermoRun,
  ThermoData,
  ColorMode,
  ColormapName,
  VisualizationState,
  ExportImageOptions,
  ExportVideoOptions,
  BondSourceType,
  BondProperties,
  BondData,
  BondStats,
  BondDivergence,
} from './types';

export { hasUsableSourceIds, hasStableAtomIdentity, framesShareAtomOrder } from './frameIdentity';

export {
  LEGACY_ATOM_TYPE_SEMANTICS,
  LEGACY_DISTANCE_SEMANTICS,
  NEUTRAL_TYPE_DISPLAY_RADIUS,
  normalizeAtomTypeSemantics,
  normalizeDistanceSemantics,
  resolveAtomicNumber,
  hasCompleteElementMapping,
  stableCategoricalColor,
  resolveTypeLabel,
  resolveTypeColor,
  resolveTypeDisplayRadius,
  hasAngstromDistances,
  canInferCovalentBonds,
} from './frameSemantics';

export {
  UNIT_LABELS,
  THERMO_QUANTITIES,
  DEFAULT_STATE,
  encodeState,
  decodeState,
} from './types';

export * from './elements';

// ─── Per-atom vector fields (velocity/force/dipole glyph support) ───
export type { VectorFieldKind, VectorFieldSpec } from './vectorFields';
export {
  detectVectorFields,
  detectFrameVectorFields,
  getVectorComponents,
  ensureVectorMagnitude,
  magnitudePercentile,
} from './vectorFields';

// ─── Streaming binary format ────────────────────────────────────────
export type {
  GlimbinHeader,
  FrameIndexEntry,
  GlimbinIndex,
  DatasetMeta,
} from './glimbin';

export {
  GLIMBIN_MAGIC,
  GLIMBIN_VERSION,
  HEADER_SIZE,
  FRAME_ENTRY_SIZE,
  FLAG_COMPRESSED,
  FLAG_LITTLE_ENDIAN,
  FLAG_VARIABLE_ATOMS,
  FLAG_HAS_BONDS,
  FLAG_HAS_PROPERTIES,
  FLAG_FRAME_IDENTITY,
  FRAME_IDENTITY_BLOCK_SIZE,
  parseHeader,
  parseFrameIndex,
  parseFrameData,
  writeHeader,
} from './glimbin';

// ─── CDN base resolution (Bandwidth Alliance scaffolding) ───────────
export {
  ATLAS_ARTIFACTS_BUCKET,
  DEFAULT_ATLAS_CDN_BASE,
  getAtlasCdnBase,
  cdnUrl,
} from './cdn';

// --- Stable render artifact contract ---------------------------------------
export * from './renderArtifact';
