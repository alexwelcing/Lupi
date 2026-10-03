All paths are under /home/user/Lupi. These contracts are frozen before the tracks start.

// ===== @atlas/core/bonds  (packages/core/src/bonds/index.ts; package.json exports "./bonds") =====
export const MOLECULAR_RECIPE_ID = 'lupi-bonds.molecular.v1' as const;
export const DISTANCE_RECIPE_ID = 'lupi-bonds.distance.v1' as const;
export type BondRecipeId = typeof MOLECULAR_RECIPE_ID | typeof DISTANCE_RECIPE_ID;
export const MOLECULAR_RECIPE_MAX_ATOMS = 2000;
export const DEFAULT_BOND_TOLERANCE = 0.45;          // store bondTolerance / URL bt; clamped 0..1.5
export const CLASH_FLOOR_A = 0.40;
export const ION_CONTACT_MARGIN_A = 0.35;            // Lupi choice (harness sensitivity 0.25/0.35/0.45)
export const METAL_METAL_SLACK_A = 0.25;             // Lupi choice
export const METAL_HYDRIDE_SLACK_A = 0.30;           // Lupi choice; r_M + 0.31 + 0.30
export const HAPTIC_TRIM_RATIO = 1.15;               // Lupi choice
export const METAL_COORDINATION_CAP = 12;
export const ION_DONOR_PRECEDENCE_A = 0.15;
export const LONG_EXCESS_A = 0.20;
export const NEAR_MISS_WINDOW_A = 0.20;              // τ < e ≤ τ + 0.20
export const MAX_ION_CONTACT_A: number;              // COMPUTED: max(ION_RADII) + max(DONOR_RADII) + ION_CONTACT_MARGIN_A (= 4.35)

export const BOND_KIND = { covalent: 0, coordination: 1, ionicContact: 2 } as const;
export type BondKindCode = 0 | 1 | 2;
export const BOND_KIND_RADIUS_SCALE = [1, 0.6, 0.45] as const;
export const BOND_KIND_STYLE_ALPHA = [255, 170, 85] as const;      // shader k = round(a*3): 3 solid, 2 dashed, 1 dotted
export const BOND_KIND_DASH = [null, { periodA: 0.30, duty: 0.60 }, { periodA: 0.16, duty: 0.45 }] as const;

export const REMOVAL_REASON = {
  clash: 1, hydrogenPair: 2, hydrogenSinglePartner: 3, hydrogenMetalContact: 4,
  acuteAngle: 5, valenceCap: 6, hapticTrim: 7, metalCoordinationCap: 8,
  ionDonorPrecedence: 9, ionCoordinationCap: 10, bridgedPair: 11,
} as const;

// classes.ts (explicit Z sets):
// ION = {3,11,19,37,55,87,12,20,38,56,88}; METAL = Z 21–30, 39–48, 57–80, 89–112; INERT = {2,10,18,86}; H = {1};
// COVALENT = every other Z (includes Be, Al, Ga, In, Tl, Sn, Pb, Bi, Po, Kr, Xe).
// High-spin coordination radii {25:1.61, 26:1.52, 27:1.50}. Covalent radii ELEMENT_DATA[z].radius.
// ION_RADII (Shannon 1976 CN6): Li .76 Na 1.02 K 1.38 Rb 1.52 Cs 1.67 Fr 1.80 Mg .72 Ca 1.00 Sr 1.18 Ba 1.35 Ra 1.48
// DONOR_RADII (only these donors contact an ion): O 1.40, F 1.33, Cl 1.81, Br 1.96, I 2.20, S 1.84 (Shannon CN6);
//   N 1.46 (Shannon CN4); P 2.12 (Pauling). Source comment required on each.
// Ion CN caps: Li 6, Mg 6, Na 8, Ca 8, K 10, Sr 10, Rb/Cs/Fr/Ba/Ra 12 (Lupi choice).
// Covalent caps: H 1 (2 if bridging B–H–B); B,C,N 4; O 3 (Lupi choice); F 1; Be 4; Al,Ga,In,Tl 6;
//   Si,Ge,Sn,Pb,P,As,Sb,Bi,S,Se,Te,Po 6; Cl,Br,I ≤1 non-O/F partner and ≤7 total; Xe 8 (O/F only); Kr 2 (F only).
// Step order (strategy 2.3): candidates → H–H (ignore metal–H candidates) → one partner per H (B–H–B bridging,
//   η²-H₂ keeps metal–H, hydrides ≤2) → bridged-pair (drop B–B / M–M sharing a bridging H) → acute angle (covalent
//   centres; bridging B–H exempt) → valence caps (descending stretch; bridging B–H exempt, counts 1) → metals (haptic
//   1.15, cap 12) → ions (donor precedence 0.15, CN caps) → recompute all counts from the final graph.

export interface PerceiveBondsInput {
  atomicNumbers: ArrayLike<number>; positions: ArrayLike<number>; natoms: number;
  tolerance?: number; recipe?: BondRecipeId; collectEvidence?: boolean;
}
export interface BondCounts {
  covalent: number; coordination: number; ionicContact: number;
  long: number; removed: number; nearMiss: number; clashes: number;
  fragments: number; bridgingH: number; ionCarbonClose: number;
}
export interface PerceivedBonds {
  recipe: BondRecipeId;
  params: { tolerance: number; contactMargin: number; clashFloor: number; longExcess: number };
  count: number;
  pairs: Int32Array;        // [i0,j0,…], i<j, sorted by (i,j)
  kinds: Uint8Array; distances: Float32Array; excess: Float32Array;
  evidence: { pairs: Int32Array; reasons: Uint8Array; distances: Float32Array } | null;
  counts: BondCounts;
}
export function perceiveBonds(input: PerceiveBondsInput): PerceivedBonds;

export interface DrawnBonds { count: number; pairs: Int32Array; kinds: Uint8Array; distances: Float32Array; excess: Float32Array; sourceIndex: Int32Array; }
export function filterPerceivedBonds(p: PerceivedBonds, opts: { types: ArrayLike<number>; hiddenTypes?: ReadonlySet<number>; showContacts: boolean }): DrawnBonds;

export type BondProfile = 'auto' | 'distance' | 'molecular';
export interface RecipeGateInput {
  natoms: number; frameCount: number; sourceBondCount: number; inferenceAllowed: boolean;
  periodic: boolean | undefined;            // Frame.periodic (only the XYZ parser sets it)
  chemistry: FrameChemistry | null | undefined;
  isOmol25Record: boolean;                  // frame.sourceRecord?.dataset === 'omol25'
  profile: BondProfile;
}
// 'source' if sourceBondCount>0; null if !inferenceAllowed; DISTANCE if profile==='distance' || natoms>2000 || periodic!==false;
// MOLECULAR if profile==='molecular'; MOLECULAR if profile==='auto' && chemistry && (frameCount===1 || isOmol25Record); else DISTANCE.
export function selectBondRecipe(input: RecipeGateInput): BondRecipeId | 'source' | null;
export function bondMethodParagraph(params?: { tolerance?: number }): string;   // Learn copy, from constants
export function bondMethodSentence(opts: { recipe: BondRecipeId; tolerance: number; collection?: string | null; row?: number | null }): string;
// packages/core/src/bonds/validation-v1.json (Track A, committed before the v1 deploy):
// { schema:'lupi.bonds-validation.v1', recipe, dataset:'colabfit/OMol25_neutral_validation', rows:27697, generatedAt,
//   hard:{multiBondH:0, overValent:0, covalentIonSticks:0, deterministic:true, p99Ms},
//   reported:{ionContactHistogram, isolatedIons, ionsWithContactPct, mulliken
IntegralityFailPct, rowsChangedPct, p50Ms, p95Ms}, sensitivity:{…}, gallery:{files:73, identicalPairs:boolean} }

// ===== @atlas/core/objectFacts =====
// ObjectFactsOptions gains bondPairs?: ArrayLike<number>; when present it replaces computeBonds for rings/symmetry.

// ===== @atlas/core types (packages/core/src/types.ts) =====
export type ChemistrySource = 'record' | 'split-definition' | 'file-declared' | 'unavailable';
export interface FrameChemistry { totalCharge: number | null; spinMultiplicity: number | null; source: ChemistrySource; domain: string | null; }
export interface FrameSourceRecord { dataset: 'omol25'; collection: string | null; row: number | null; method: string | null;
  energyEv: number | null; maxForceEvPerA: number | null; homoLumoGapEv: number | null; license: string | null; source: string | null; }
// interface Frame { …; chemistry?: FrameChemistry; sourceRecord?: FrameSourceRecord; periodic?: boolean }
// periodic: XYZ parser only (true iff Lattice=); undefined elsewhere means "not eligible for molecular".
// None of the three are hashed into the decoded-frame digest. Inferred bonds are NEVER written to Frame.bonds.

// ===== XYZ comment contract (edge structures and featured pick files) =====
// OMol25 {collection} row={row} | collection={collection} | formula={hill} | configuration_id=… | property_id=… |
// method=ωB97M-V | charge={int} | multiplicity={int} | charge_source={record|split-definition|unavailable} |
// data_id={id} | energy_eV={num} | max_force_eV_per_A={num} | homo_lumo_gap_eV={num} | coordinates=source |
// bonds=not-provided | license=CC-BY-4.0 | source={hf repo}
// Omit charge=/multiplicity= when charge_source=unavailable; omit data_id/gap when absent. No Properties= in wave 1.
// Headers: x-lupi-bond-topology: not-provided (kept); x-lupi-charge-provenance; x-lupi-bond-inference: lupi-bonds.molecular.v1.
// Both new headers are added to access-control-expose-headers in apps/mcp-worker/src/index.ts.

// ===== Edge row JSON (apps/mcp-worker + packages/ui/src/molecules/remoteOmol.ts) =====
// charge: number|null; spinMultiplicity: number|null; chargeSource: 'record'|'split-definition'|'unavailable';
// domain: string|null; homoLumoGapEv: number|null; metaTruncated?: boolean; multiplicity kept ("ColabFit column, not spin").
// Timeout: HTTP 504 {status:'slow'} → OmolSlowError in remoteOmol.ts; warming stays 202 {status:'warming'} (existing error).
// Cache: injectable options.cache; default `(globalThis as { caches?: { default?: Cache } }).caches?.default ?? null`; key includes 'omol25-xyz-v2'.

// ===== @atlas/core/omol25 (packages/core/src/omol25/index.ts) =====
export type Omol25CollectionId = 'neutral-train'|'neutral-validation'|'all-train-preview'|'train-4m-preview'|'validation-preview';
export const OMOL25_COLLECTION_IDS: readonly Omol25CollectionId[];
export interface Omol25Collection { id: Omol25CollectionId; label: string; repo: string; indexedRows: number;
  hfEstimatedRows: number; sourceRows: number; coverage: 'complete'|'indexed-preview'; license: 'CC-BY-4.0'; }
export const OMOL25_COLLECTIONS: readonly Omol25Collection[];
// sourceRows: 34335828 / 27697 / 101666280 / 3986754 / 2762021
export const OMOL25_CITATION = 'Levine et al. 2025, The Open Molecules 2025 (OMol25) Dataset, arXiv:2505.08762';
export const OMOL25_PAPER_URL = 'https://arxiv.org/abs/2505.08762';
export function omolStructurePath(collection: Omol25CollectionId, row: number): string;
export function parseOmolStructurePath(url: string): { collection: Omol25CollectionId; row: number; featured: boolean } | null;
export function isOmol25Url(url: string): boolean;
export function omolPickKey(row: number): string;     // `omol25_nv_${row}`
export function omolTitle(formula: string): string;   // `${formula} (OMol25)`
export const OMOL25_COORDINATE_TRUTH = 'Source DFT coordinates (ωB97M-V/def2-TZVPD, OMol25).';
export function omolBondTruth(): string;   // 'OMol25 supplies no bonds. Lines are Lupi\'s inference (lupi-bonds.molecular.v1): dotted lines are ionic contacts, dashed lines metal coordination.'
export function omolCardTruth(): string;   // 'Source DFT coordinates, charge and spin. OMol25 supplies no bonds; Lupi infers them and labels them.'
export const OMOL25_MASTHEAD_BOND_SENTENCE = 'OMol25 supplies no bond topology; Lupi infers bonds with a published rule and labels them.';
export function omolGeometryState(maxForceEvPerA: number | null): string | null;
//   ≥0.5 → 'Snapshot away from a minimum: largest force {x.x} eV/Å'; <0.5 → 'Near a minimum: largest force {x.xx} eV/Å'
export function omolChargeSpin(c: { totalCharge: number|null; spinMultiplicity: number|null; source: string }): string;
export function omolSpinWord(m: number): string;
export function omolAttribution(): string;
export function omolDomainCaveat(domain: string | null): string | null;   // reactivity|trans1x|rgd → 'Reaction-path snapshot: stretched bonds may be absent.'

// ===== Featured picks =====
export interface OmolFeaturedPickV1 {
  id: string; collection: 'neutral-validation'; dataset: 'colabfit/OMol25_neutral_validation'; row: number;
  configurationId: string; propertyId: string; formula: string; atoms: number; elements: string[];
  shelf: 'drug-like'|'amino-acid-ligand'|'conformers'|'off-equilibrium'|'salt-complexes'|'small';
  home: boolean; domain: string | null; domainLabel: string;
  charge: number; spinMultiplicity: number; chargeSource: 'record';
  energyEv: number | null; maxForceEvPerA: number | null; homoLumoGapEv: number | null;
  title: string; name: null | { text: string; id: string; url: string; source: 'chembl'|'pubchem'; formulaMatch: true };
  xyz: string; edge: string; ink: string; sha256: string; fetchedAt: string; bondRecipe: 'lupi-bonds.molecular.v1';
}
export interface OmolFeaturedFileV1 { schema: 'lupi.omol25-featured.v1'; license: 'CC-BY-4.0'; citation: string; picks: OmolFeaturedPickV1[]; }
// packages/ui/src/landing/omolShelf.data.ts (generated, imports nothing):
export interface OmolPick { id: string; title: string; formula: string; atoms: number; elements: string[];
  shelf: string; home: boolean; domainLabel: string; charge: number; spinMultiplicity: number; file: string; ink: string; }
export const OMOL_PICKS: readonly OmolPick[];
// Track D helpers: omolShelfForDay(picks, dayNumber, n=6) = home[(dayNumber*6+i) mod N];
// isFormulaShapedForOmol(q): whole string covered by /[A-Z][a-z]?\d*/ tokens, ≥2 tokens, all in
// {H,C,N,O,F,P,S,Cl,Br,I,Si,B,Li,Na,K,Mg,Ca}, and contains a digit or is mixed-case.
// URL policy: same-origin ^/datasets/omol25/featured/omol25_nv_\d+\.xyz$ is trusted.

// ===== Per-pair access in the viewer (Track B; read-only for others) =====
// packages/ui/src/bonds/perceivedBonds.ts
export function resolveFrameRecipe(frame: Frame, opts: { profile: BondProfile; frameCount: number }): BondRecipeId | 'source' | null;
export function getPerceivedBonds(frame: Frame, opts: { recipe: BondRecipeId; tolerance: number }): PerceivedBonds | null; // null when > 2000 atoms or unresolved elements
// Memoised in a WeakMap on frame.positions + `${recipe}|${tolerance}`. Unfiltered. Consumers that show drawn bonds
// (Bonds.tsx, AtomInfoHUD, MCP includeBonds, export) apply filterPerceivedBonds with the store's hidden types and
// showBondContacts. Object Facts takes covalent+coordination pairs from the unfiltered result.
// The molecular recipe runs on the main thread through this cache; it never uses bondWorker.ts or the GPU path.

// ===== Store / URL (Track B) =====
// bondProfile: BondProfile — s= delta key `brp` ('d'|'m'; omitted for auto).
// showBondContacts: boolean — s= delta key `bco` (0 when false; omitted when true).
// Reserved for later phases: `bor` (bond orders), `bhb` (hydrogen bonds). All four were verified unused;
// `bp` = backgroundPitchDegrees and `bc` = bondCutoff, and `bo` already exists — never reuse them.
// lastBondDetail: BondsUpdateDetail | null; reportBondsUpdate(source, count, detail?)
export interface BondsUpdateDetail { recipe: BondRecipeId | 'source'; kinds: { covalent: number; coordination: number; ionicContact: number };
  evidence: { long: number; removed: number; nearMiss: number; clashes: number }; tolerance: number; }
// shouldUseGpuBondInference(natoms, sourceBonds, gpuRequested, forceGpuAtomThreshold?, recipe?) → false for molecular.

// ===== Render spec (packages/core/src/renderArtifact.ts) =====
// view.bonds optional (allowed, not required): topology 'source-frame-v1'|'covalent-inference-v1'|'molecular-inference-v1';
//   recipe 'lupi-bonds.molecular.v1'|'lupi-bonds.distance.v1'; contacts boolean. sourceBondCount no longer emitted, still rejected.
// Raster with bonds keeps throwing in wave 1. GLB meshes 'lupi-bonds-covalent'|'lupi-bonds-coordination'|'lupi-contacts-ionic';
//   userData { lupiBondRecipe, lupiBondKind: 'covalent'|'coordination'|'ionicContact', lupiProvenance: 'inferred' }.

// ===== MCP (tool count stays 31) =====
// status()/lupi.status/lupi.viewer_state add: bondRecipe, bondToleranceAdjusted, bondKinds, bondEvidence,
//   chemistry {totalCharge, spinMultiplicity, source, domain} | null. bondCount = covalent + coordination.
// lupi.viewer_state { includeBonds?: boolean } → bonds: Array<[i, j, 'covalent'|'coordination'|'ionicContact', lengthA, excessA]> (≤5000),
//   bondsTruncated, bondsFilter { hiddenTypes: number[], contacts: boolean }.
// lupi.set_viewer adds bondProfile?: BondProfile; showBondContacts?: boolean.
// lupi.browse_collection molecules add charge, spinMultiplicity, chargeSource, domain, homoLumoGapEv;
//   sourceTruth { bondTopology: 'not-provided', viewerBonds: { recipe: 'lupi-bonds.molecular.v1', provenance: 'inferred' } }.

// ===== Analytics (Track D) =====
// sourceKind(url) → 'omol25' when isOmol25Url(url). molecule_loaded gains entry?:
//   'home-shelf'|'home-surprise'|'finder'|'library'|'switcher'|'palette' from takeOpenEntry() (sessionStorage 'lupi.openEntry', 30 s expiry).

// ===== Ink (Track D) =====
// InkModel gains optional bk?: number[] (BondKindCode per pair in b). Pick ink = perceiveBonds(molecular, τ 0.45).

// ===== File ownership / merge order =====
// Merge order A → C → B → D.
// - packages/core/package.json and core/src/objectFacts/*: A only. packages/core/src/omol25/*: C only.
// - apps/mcp-worker/src/index.ts: C only, and only the expose-headers string.
// - ViewerApp.tsx: B adds only the BondLegendHUD mount; D edits only the palette Discover group.
// - mcp/schemas.ts: B only. mcp/tools.ts: C only. store.ts, savedViews.ts, StudyLensPanel.tsx, studyFacts.ts, CameraToys.tsx, objectFactsForFile.ts, AGENTS.md: B only.
// - remoteOmol.ts: C only. LibraryCard.tsx, Omol25Collection.tsx (+test), MoleculeFinder.tsx (+test): D only.
// Preserved strings: "OMol25 supplies no bond topology", "OMol25 supplies no bonds", "Bond guides", 'Visual guide only' (distance), and the warming sentence matched by /warming.*15 seconds/.