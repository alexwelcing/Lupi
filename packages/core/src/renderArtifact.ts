/**
 * Environment-neutral render artifact contract.
 *
 * This module owns the semantic inputs to a render. Persistence, queueing,
 * renderer execution, and delivery are deliberately outside this package.
 * Keeping those concerns separate lets the browser and edge agree on what an
 * artifact means without coupling either runtime to the other's machinery.
 */

const COLORMAPS_V1 = [
  'viridis', 'inferno', 'coolwarm', 'plasma', 'magma', 'cividis', 'neon',
  'sunset', 'vaporwave', 'ocean', 'fire', 'ice', 'forest', 'cyberpunk',
  'autumn', 'grayscale', 'turbo',
] as const;
const MATERIAL_PRESETS_V1 = ['default', 'matte', 'metallic', 'glass', 'plastic'] as const;
const ENVIRONMENT_PRESETS_V1 = [
  'city', 'studio', 'dawn', 'night', 'warehouse', 'forest', 'apartment', 'park', 'none',
] as const;
const HEX_COLOR_PATTERN_V1 = /^#[0-9a-fA-F]{6}$/;

export const RENDER_REQUEST_VERSION_V1 = 'lupi.render-request.v1' as const;
export const RENDER_ARTIFACT_SPEC_VERSION_V1 = 'lupi.render-artifact-spec.v1' as const;
export const RENDER_DELIVERY_VERSION_V1 = 'lupi.render-delivery.v1' as const;
export const RENDER_CAPABILITY_VERSION_V1 = 'lupi.render-capability.v1' as const;
export const RENDERER_FINGERPRINT_VERSION_V1 = 'lupi.renderer-fingerprint.v1' as const;
export const RENDER_ARTIFACT_KEY_VERSION_V1 = 'lupi.render-artifact-key.v1' as const;

export const MIN_RASTER_DIMENSION_V1 = 64;
export const MAX_RASTER_DIMENSION_V1 = 4096;
export const MIN_INLINE_BYTES_V1 = 1024;
export const MAX_INLINE_BYTES_V1 = 128 * 1024 * 1024;

export type RenderJsonPrimitiveV1 = string | number | boolean | null;
export type RenderJsonValueV1 =
  | RenderJsonPrimitiveV1
  | readonly RenderJsonValueV1[]
  | RenderJsonObjectV1;
export interface RenderJsonObjectV1 {
  readonly [key: string]: RenderJsonValueV1;
}

export type RenderFormatV1 = 'png' | 'jpeg' | 'webp' | 'glb' | 'usdz';
export type RenderRasterFormatV1 = 'png' | 'jpeg' | 'webp';
export type RenderModelFormatV1 = 'glb' | 'usdz';
export type RenderAlphaModeV1 = 'opaque' | 'transparent' | 'not-applicable';

export interface RenderFormatRuleV1 {
  readonly kind: 'raster' | 'model';
  readonly mimeType: string;
  readonly extension: string;
  readonly alphaModes: readonly RenderAlphaModeV1[];
  readonly dimensions: 'required' | 'forbidden';
}

/** Contract-level format rules. Renderer capabilities may narrow these rules. */
export const RENDER_FORMAT_RULES_V1 = {
  png: {
    kind: 'raster',
    mimeType: 'image/png',
    extension: 'png',
    alphaModes: ['opaque', 'transparent'],
    dimensions: 'required',
  },
  jpeg: {
    kind: 'raster',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    alphaModes: ['opaque'],
    dimensions: 'required',
  },
  webp: {
    kind: 'raster',
    mimeType: 'image/webp',
    extension: 'webp',
    alphaModes: ['opaque', 'transparent'],
    dimensions: 'required',
  },
  glb: {
    kind: 'model',
    mimeType: 'model/gltf-binary',
    extension: 'glb',
    alphaModes: ['not-applicable'],
    dimensions: 'forbidden',
  },
  usdz: {
    kind: 'model',
    mimeType: 'model/vnd.usdz+zip',
    extension: 'usdz',
    alphaModes: ['not-applicable'],
    dimensions: 'forbidden',
  },
} as const satisfies Readonly<Record<RenderFormatV1, RenderFormatRuleV1>>;

export type RenderLayerSupportV1 = 'supported' | 'unsupported';
export type RenderLayerDataDigestDispositionV1 =
  | 'source-content'
  | 'canonical-state'
  | 'separate-required';
export type RenderLayerResetDefaultV1 = 'enabled' | 'disabled' | 'derived';
export type RenderLayerCanonicalStateFieldV1 = `view.${string}` | 'source-only';

export interface RenderLayerRegistryEntryV1 {
  readonly description: string;
  readonly support: RenderLayerSupportV1;
  /** Stable field in RenderArtifactSpecV1 which owns the enabled state. */
  readonly canonicalStateField: RenderLayerCanonicalStateFieldV1;
  /** How any data rendered by the layer is content-addressed. */
  readonly dataDigest: RenderLayerDataDigestDispositionV1;
  /** Viewer reset behavior; `derived` means there is no independent toggle. */
  readonly resetDefault: RenderLayerResetDefaultV1;
}

/**
 * Semantic layers which can contribute visible pixels or model geometry.
 *
 * A layer is unsupported when V1 lacks enough canonical state or a digest for
 * its dynamic data. Keeping it in this exhaustive inventory prevents adapters
 * from silently treating an enabled boolean as a complete artifact contract.
 */
export const RENDER_LAYER_REGISTRY_V1 = {
  background: {
    description: 'App background or environment dome',
    support: 'supported',
    canonicalStateField: 'view.background',
    dataDigest: 'separate-required',
    resetDefault: 'enabled',
  },
  atoms: {
    description: 'Atom geometry',
    support: 'supported',
    canonicalStateField: 'view.atoms',
    dataDigest: 'source-content',
    resetDefault: 'enabled',
  },
  vectorGlyphs: {
    description: 'Per-atom vector glyphs',
    support: 'supported',
    canonicalStateField: 'view.vectorGlyphs',
    dataDigest: 'source-content',
    resetDefault: 'disabled',
  },
  atomClusters: {
    description: 'Far-distance atom cluster representation',
    support: 'unsupported',
    canonicalStateField: 'view.atomClusters',
    dataDigest: 'source-content',
    resetDefault: 'derived',
  },
  bonds: {
    description: 'Bond geometry',
    support: 'supported',
    canonicalStateField: 'view.bonds',
    dataDigest: 'source-content',
    resetDefault: 'disabled',
  },
  simulationCell: {
    description: 'Simulation or unit-cell bounds',
    support: 'supported',
    canonicalStateField: 'source-only',
    dataDigest: 'source-content',
    resetDefault: 'enabled',
  },
  filterShell: {
    description: 'Molecule filter shell',
    support: 'supported',
    canonicalStateField: 'view.filterShell',
    dataDigest: 'source-content',
    resetDefault: 'disabled',
  },
  moleculeShadow: {
    description: 'Filter-shell molecule shadow',
    support: 'supported',
    canonicalStateField: 'view.moleculeShadow',
    dataDigest: 'source-content',
    resetDefault: 'derived',
  },
  contactShadows: {
    description: 'Ground contact shadows',
    support: 'supported',
    canonicalStateField: 'view.contactShadows',
    dataDigest: 'source-content',
    resetDefault: 'derived',
  },
  ghostAtoms: {
    description: 'Comparison trajectory atoms',
    support: 'unsupported',
    canonicalStateField: 'view.ghostAtoms',
    dataDigest: 'separate-required',
    resetDefault: 'disabled',
  },
  annotations: {
    description: 'User-authored atom annotations',
    support: 'unsupported',
    canonicalStateField: 'view.annotations',
    dataDigest: 'canonical-state',
    resetDefault: 'disabled',
  },
  knowledgeLabels: {
    description: 'Knowledge-graph labels',
    support: 'unsupported',
    canonicalStateField: 'view.knowledgeLabels',
    dataDigest: 'canonical-state',
    resetDefault: 'enabled',
  },
  selectionMarkers: {
    description: 'Hover, selection, and neighbor markers',
    support: 'unsupported',
    canonicalStateField: 'view.selectionMarkers',
    dataDigest: 'canonical-state',
    resetDefault: 'disabled',
  },
  atomTrails: {
    description: 'Tracked-atom trails',
    support: 'unsupported',
    canonicalStateField: 'view.atomTrails',
    dataDigest: 'source-content',
    resetDefault: 'disabled',
  },
  axes: {
    description: 'Orientation axes',
    support: 'supported',
    canonicalStateField: 'view.axes',
    dataDigest: 'canonical-state',
    resetDefault: 'enabled',
  },
  scaleBar: {
    description: 'Publication scale bar',
    support: 'unsupported',
    canonicalStateField: 'view.scaleBar',
    dataDigest: 'source-content',
    resetDefault: 'enabled',
  },
} as const satisfies Readonly<Record<string, RenderLayerRegistryEntryV1>>;

export type RenderLayerIdV1 = keyof typeof RENDER_LAYER_REGISTRY_V1;
export type RenderLayerStateV1 = Readonly<Record<RenderLayerIdV1, boolean>>;
export type RenderLayerCapabilityV1 = Readonly<Record<RenderLayerIdV1, boolean>>;

export type Sha256DigestV1 = `sha256:${string}`;
export type RenderRequestKeyV1 = `request-sha256:${string}`;
export type RenderSpecIdV1 = `spec-sha256:${string}`;
export type RendererFingerprintV1 = `renderer-sha256:${string}`;
export type RenderArtifactKeyV1 = `artifact-sha256:${string}`;
export type RenderArtifactDigestV1 = Sha256DigestV1;

/** Immutable, decoded source content. */
export interface RenderContentSourceV1 {
  readonly kind: 'content';
  readonly mediaType: string;
  readonly contentDigest: Sha256DigestV1;
}

/**
 * A source which has not yet been resolved to immutable bytes. It can receive
 * a request key, but not a spec id or artifact key.
 */
export interface RenderReferenceSourceV1 {
  readonly kind: 'reference';
  readonly uri: string;
  readonly revision?: string;
}

export type RenderSourceV1 = RenderContentSourceV1 | RenderReferenceSourceV1;

export interface RenderSpecBaseV1<TSource extends RenderSourceV1> {
  readonly version: typeof RENDER_ARTIFACT_SPEC_VERSION_V1;
  readonly source: TSource;
  readonly format: RenderFormatV1;
  readonly width?: number;
  readonly height?: number;
  readonly alpha: RenderAlphaModeV1;
  readonly frame: number;
  readonly layers: RenderLayerStateV1;
  /** Canonical JSON containing camera, material, lighting, and other style. */
  readonly view: RenderJsonObjectV1;
}

/** Submission-time semantics; the source may still need to be resolved. */
export type RenderRequestSpecV1 = RenderSpecBaseV1<RenderSourceV1>;

/** Final artifact semantics; the source is structurally content-addressed. */
export type RenderArtifactSpecV1 = RenderSpecBaseV1<RenderContentSourceV1>;

/** Transport preferences. No field in this type participates in identity. */
export interface RenderDeliveryV1 {
  readonly version: typeof RENDER_DELIVERY_VERSION_V1;
  readonly inline: boolean;
  readonly maxInlineBytes: number;
  readonly sync: boolean;
  readonly filename?: string;
}

export interface RenderRequestV1 {
  readonly version: typeof RENDER_REQUEST_VERSION_V1;
  readonly spec: RenderRequestSpecV1;
  readonly delivery: RenderDeliveryV1;
}

export interface RenderFormatCapabilityV1 {
  readonly enabled: boolean;
  readonly alphaModes: readonly RenderAlphaModeV1[];
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

export interface RenderCapabilityV1 {
  readonly version: typeof RENDER_CAPABILITY_VERSION_V1;
  /** Every V1 format is named explicitly so an omission cannot imply support. */
  readonly formats: Readonly<Record<RenderFormatV1, RenderFormatCapabilityV1>>;
  /** Every named visible layer is explicitly supported or unsupported. */
  readonly layers: RenderLayerCapabilityV1;
}

export interface RendererFingerprintInputV1 {
  readonly version: typeof RENDERER_FINGERPRINT_VERSION_V1;
  readonly renderer: string;
  readonly rendererVersion: string;
  readonly buildId: string;
  readonly executionClass: string;
  /** Browser/engine/GPU or container/runtime facts which can affect bytes. */
  readonly runtime: RenderJsonObjectV1;
  /** Explicit applied renderer flags, encoder policy, and color/tone ownership. */
  readonly determinism: RenderJsonObjectV1;
  readonly capability: RenderCapabilityV1;
}

export interface RenderArtifactKeyInputV1 {
  readonly specId: RenderSpecIdV1;
  readonly rendererFingerprint: RendererFingerprintV1;
}

/** Decoded bytes always travel with the digest of those bytes. */
export interface DecodedRenderArtifactV1 {
  readonly bytes: Uint8Array;
  readonly artifactDigest: RenderArtifactDigestV1;
}

export class RenderArtifactValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'RenderArtifactValidationError';
    this.path = path;
  }
}

const FORMAT_IDS = Object.keys(RENDER_FORMAT_RULES_V1) as RenderFormatV1[];
const LAYER_IDS = Object.keys(RENDER_LAYER_REGISTRY_V1) as RenderLayerIdV1[];
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const SPEC_ID_PATTERN = /^spec-sha256:[0-9a-f]{64}$/;
const RENDERER_FINGERPRINT_PATTERN = /^renderer-sha256:[0-9a-f]{64}$/;

export function createRenderLayerStateV1(
  enabled: Iterable<RenderLayerIdV1> = [],
): RenderLayerStateV1 {
  const enabledSet = new Set(enabled);
  return Object.fromEntries(LAYER_IDS.map((id) => [id, enabledSet.has(id)])) as Record<RenderLayerIdV1, boolean>;
}

export function validateRenderRequestSpecV1(value: unknown): RenderRequestSpecV1 {
  const input = requireRecord(value, '$.spec');
  requireExactKeys(
    input,
    ['version', 'source', 'format', 'width', 'height', 'alpha', 'frame', 'layers', 'view'],
    ['version', 'source', 'format', 'alpha', 'frame', 'layers', 'view'],
    '$.spec',
  );
  requireLiteral(input.version, RENDER_ARTIFACT_SPEC_VERSION_V1, '$.spec.version');

  const source = validateRenderSourceV1(input.source);
  const format = requireOneOf(input.format, FORMAT_IDS, '$.spec.format');
  const rule = RENDER_FORMAT_RULES_V1[format];
  const alpha = requireOneOf(input.alpha, [...rule.alphaModes], '$.spec.alpha');
  const frame = requireInteger(input.frame, 0, Number.MAX_SAFE_INTEGER, '$.spec.frame');

  let width: number | undefined;
  let height: number | undefined;
  if (rule.dimensions === 'required') {
    width = requireInteger(
      input.width,
      MIN_RASTER_DIMENSION_V1,
      MAX_RASTER_DIMENSION_V1,
      '$.spec.width',
    );
    height = requireInteger(
      input.height,
      MIN_RASTER_DIMENSION_V1,
      MAX_RASTER_DIMENSION_V1,
      '$.spec.height',
    );
  } else if ('width' in input || 'height' in input) {
    throw new RenderArtifactValidationError(
      '$.spec',
      `${format} artifacts must not declare raster dimensions`,
    );
  }

  const layers = validateLayerBooleanMap(input.layers, '$.spec.layers');
  if (alpha === 'transparent' && layers.background) {
    throw new RenderArtifactValidationError(
      '$.spec.layers.background',
      'must be disabled for transparent raster output',
    );
  }
  if (rule.kind === 'model') {
    for (const layer of LAYER_IDS) {
      if (layers[layer] && layer !== 'atoms' && layer !== 'bonds') {
        throw new RenderArtifactValidationError(
          `$.spec.layers.${layer}`,
          `${layer} is not part of the V1 model artifact profile`,
        );
      }
    }
  }
  const view = normalizeJsonObject(input.view, '$.spec.view');
  validateEnabledLayerStateV1(layers, view);
  validateRenderViewShapeV1(format, layers, view);
  return {
    version: RENDER_ARTIFACT_SPEC_VERSION_V1,
    source,
    format,
    ...(width === undefined ? {} : { width }),
    ...(height === undefined ? {} : { height }),
    alpha,
    frame,
    layers,
    view,
  };
}

export function validateRenderArtifactSpecV1(value: unknown): RenderArtifactSpecV1 {
  const spec = validateRenderRequestSpecV1(value);
  if (spec.source.kind !== 'content') {
    throw new RenderArtifactValidationError(
      '$.spec.source',
      'finalized artifact specs require immutable decoded content and its SHA-256 digest',
    );
  }
  return spec as RenderArtifactSpecV1;
}

export function validateRenderDeliveryV1(value: unknown): RenderDeliveryV1 {
  const input = requireRecord(value, '$.delivery');
  requireExactKeys(
    input,
    ['version', 'inline', 'maxInlineBytes', 'sync', 'filename'],
    ['version', 'inline', 'maxInlineBytes', 'sync'],
    '$.delivery',
  );
  requireLiteral(input.version, RENDER_DELIVERY_VERSION_V1, '$.delivery.version');
  const inline = requireBoolean(input.inline, '$.delivery.inline');
  const maxInlineBytes = requireInteger(
    input.maxInlineBytes,
    MIN_INLINE_BYTES_V1,
    MAX_INLINE_BYTES_V1,
    '$.delivery.maxInlineBytes',
  );
  const sync = requireBoolean(input.sync, '$.delivery.sync');
  const filename = input.filename === undefined
    ? undefined
    : requireFilename(input.filename, '$.delivery.filename');
  return {
    version: RENDER_DELIVERY_VERSION_V1,
    inline,
    maxInlineBytes,
    sync,
    ...(filename === undefined ? {} : { filename }),
  };
}

export function validateRenderRequestV1(value: unknown): RenderRequestV1 {
  const input = requireRecord(value, '$');
  requireExactKeys(input, ['version', 'spec', 'delivery'], ['version', 'spec', 'delivery'], '$');
  requireLiteral(input.version, RENDER_REQUEST_VERSION_V1, '$.version');
  return {
    version: RENDER_REQUEST_VERSION_V1,
    spec: validateRenderRequestSpecV1(input.spec),
    delivery: validateRenderDeliveryV1(input.delivery),
  };
}

export function validateRenderCapabilityV1(value: unknown): RenderCapabilityV1 {
  const input = requireRecord(value, '$.capability');
  requireExactKeys(input, ['version', 'formats', 'layers'], ['version', 'formats', 'layers'], '$.capability');
  requireLiteral(input.version, RENDER_CAPABILITY_VERSION_V1, '$.capability.version');

  const formatInput = requireRecord(input.formats, '$.capability.formats');
  requireExactKeys(formatInput, FORMAT_IDS, FORMAT_IDS, '$.capability.formats');
  const formats = Object.fromEntries(FORMAT_IDS.map((format) => [
    format,
    validateFormatCapability(format, formatInput[format]),
  ])) as Record<RenderFormatV1, RenderFormatCapabilityV1>;
  const layers = validateLayerBooleanMap(input.layers, '$.capability.layers');
  for (const layer of LAYER_IDS) {
    if (layers[layer] && RENDER_LAYER_REGISTRY_V1[layer].support === 'unsupported') {
      throw new RenderArtifactValidationError(
        `$.capability.layers.${layer}`,
        `cannot claim unsupported V1 layer ${layer}`,
      );
    }
  }
  return { version: RENDER_CAPABILITY_VERSION_V1, formats, layers };
}

export function validateRendererFingerprintInputV1(value: unknown): RendererFingerprintInputV1 {
  const input = requireRecord(value, '$.rendererFingerprint');
  requireExactKeys(
    input,
    ['version', 'renderer', 'rendererVersion', 'buildId', 'executionClass', 'runtime', 'determinism', 'capability'],
    ['version', 'renderer', 'rendererVersion', 'buildId', 'executionClass', 'runtime', 'determinism', 'capability'],
    '$.rendererFingerprint',
  );
  requireLiteral(input.version, RENDERER_FINGERPRINT_VERSION_V1, '$.rendererFingerprint.version');
  const runtime = normalizeJsonObject(input.runtime, '$.rendererFingerprint.runtime');
  const determinism = normalizeJsonObject(input.determinism, '$.rendererFingerprint.determinism');
  if (Object.keys(runtime).length === 0) {
    throw new RenderArtifactValidationError('$.rendererFingerprint.runtime', 'must not be empty');
  }
  if (Object.keys(determinism).length === 0) {
    throw new RenderArtifactValidationError('$.rendererFingerprint.determinism', 'must not be empty');
  }
  return {
    version: RENDERER_FINGERPRINT_VERSION_V1,
    renderer: requireIdentifier(input.renderer, '$.rendererFingerprint.renderer'),
    rendererVersion: requireIdentifier(input.rendererVersion, '$.rendererFingerprint.rendererVersion'),
    buildId: requireIdentifier(input.buildId, '$.rendererFingerprint.buildId'),
    executionClass: requireIdentifier(input.executionClass, '$.rendererFingerprint.executionClass'),
    runtime,
    determinism,
    capability: validateRenderCapabilityV1(input.capability),
  };
}

/**
 * Proves a renderer can honor the entire spec. Disabled layers are harmless;
 * every enabled layer must be declared supported by the fingerprinted renderer.
 */
export function assertRenderCapabilitySupportsSpecV1(
  capabilityValue: unknown,
  specValue: unknown,
): void {
  const capability = validateRenderCapabilityV1(capabilityValue);
  const spec = validateRenderArtifactSpecV1(specValue);
  const formatCapability = capability.formats[spec.format];
  if (!formatCapability.enabled) {
    throw new RenderArtifactValidationError('$.spec.format', `${spec.format} is unsupported by this renderer`);
  }
  if (!formatCapability.alphaModes.includes(spec.alpha)) {
    throw new RenderArtifactValidationError(
      '$.spec.alpha',
      `${spec.alpha} is unsupported for ${spec.format} by this renderer`,
    );
  }
  if (RENDER_FORMAT_RULES_V1[spec.format].kind === 'raster') {
    if (spec.width! > formatCapability.maxWidth! || spec.height! > formatCapability.maxHeight!) {
      throw new RenderArtifactValidationError(
        '$.spec',
        `${spec.width}x${spec.height} exceeds this renderer's ${formatCapability.maxWidth}x${formatCapability.maxHeight} limit`,
      );
    }
  }
  for (const layer of LAYER_IDS) {
    if (spec.layers[layer] && !capability.layers[layer]) {
      throw new RenderArtifactValidationError(
        `$.spec.layers.${layer}`,
        `enabled layer ${layer} is unsupported by this renderer`,
      );
    }
  }
}

/** Canonical JSON: sorted object keys, stable array order, and no lossy values. */
export function canonicalizeRenderValueV1(value: unknown): string {
  return canonicalize(value, '$', new WeakSet<object>());
}

/** A request key exists even while its source is still a mutable reference. */
export function renderRequestKeyInputV1(requestValue: unknown): string {
  const request = validateRenderRequestV1(requestValue);
  return canonicalizeRenderValueV1({
    version: RENDER_REQUEST_VERSION_V1,
    spec: request.spec,
  });
}

export async function computeRenderRequestKeyV1(requestValue: unknown): Promise<RenderRequestKeyV1> {
  return `request-sha256:${await sha256Hex(utf8(renderRequestKeyInputV1(requestValue)))}`;
}

/**
 * The spec identity is available only after source bytes are resolved. Delivery
 * is structurally absent from this input and therefore cannot affect specId.
 */
export function renderSpecIdInputV1(specValue: unknown): string {
  const spec = validateRenderArtifactSpecV1(specValue);
  return canonicalizeRenderValueV1(spec);
}

export async function computeRenderSpecIdV1(specValue: unknown): Promise<RenderSpecIdV1> {
  return `spec-sha256:${await sha256Hex(utf8(renderSpecIdInputV1(specValue)))}`;
}

export function rendererFingerprintInputV1(value: unknown): string {
  return canonicalizeRenderValueV1(validateRendererFingerprintInputV1(value));
}

export async function computeRendererFingerprintV1(value: unknown): Promise<RendererFingerprintV1> {
  return `renderer-sha256:${await sha256Hex(utf8(rendererFingerprintInputV1(value)))}`;
}

export function renderArtifactKeyInputV1(inputValue: unknown): string {
  const input = requireRecord(inputValue, '$.artifactKey');
  requireExactKeys(
    input,
    ['specId', 'rendererFingerprint'],
    ['specId', 'rendererFingerprint'],
    '$.artifactKey',
  );
  const specId = requirePattern(input.specId, SPEC_ID_PATTERN, '$.artifactKey.specId') as RenderSpecIdV1;
  const rendererFingerprint = requirePattern(
    input.rendererFingerprint,
    RENDERER_FINGERPRINT_PATTERN,
    '$.artifactKey.rendererFingerprint',
  ) as RendererFingerprintV1;
  return canonicalizeRenderValueV1({
    version: RENDER_ARTIFACT_KEY_VERSION_V1,
    specId,
    rendererFingerprint,
  });
}

export async function computeRenderArtifactKeyV1(inputValue: unknown): Promise<RenderArtifactKeyV1> {
  return `artifact-sha256:${await sha256Hex(utf8(renderArtifactKeyInputV1(inputValue)))}`;
}

/** Hashes actual decoded artifact bytes, never their base64/text transport. */
export async function computeRenderArtifactDigestV1(
  content: ArrayBuffer | ArrayBufferView,
): Promise<RenderArtifactDigestV1> {
  const bytes = copyBytes(content);
  if (bytes.byteLength === 0) {
    throw new RenderArtifactValidationError('$.artifactBytes', 'decoded artifact content must not be empty');
  }
  return `sha256:${await sha256Hex(bytes)}`;
}

/** Decodes base64 and returns bytes only together with their required digest. */
export async function decodeRenderArtifactBase64V1(dataBase64: unknown): Promise<DecodedRenderArtifactV1> {
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new RenderArtifactValidationError('$.dataBase64', 'must be a non-empty base64 string');
  }
  if (dataBase64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(dataBase64)) {
    throw new RenderArtifactValidationError('$.dataBase64', 'must be canonical padded base64');
  }
  let binary: string;
  try {
    binary = atob(dataBase64);
  } catch {
    throw new RenderArtifactValidationError('$.dataBase64', 'could not be decoded');
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, artifactDigest: await computeRenderArtifactDigestV1(bytes) };
}

function validateRenderSourceV1(value: unknown): RenderSourceV1 {
  const input = requireRecord(value, '$.spec.source');
  const kind = requireOneOf(input.kind, ['content', 'reference'] as const, '$.spec.source.kind');
  if (kind === 'content') {
    requireExactKeys(
      input,
      ['kind', 'mediaType', 'contentDigest'],
      ['kind', 'mediaType', 'contentDigest'],
      '$.spec.source',
    );
    return {
      kind,
      mediaType: requireMediaType(input.mediaType, '$.spec.source.mediaType'),
      contentDigest: requirePattern(
        input.contentDigest,
        SHA256_PATTERN,
        '$.spec.source.contentDigest',
      ) as Sha256DigestV1,
    };
  }
  requireExactKeys(input, ['kind', 'uri', 'revision'], ['kind', 'uri'], '$.spec.source');
  const uri = requireNonEmptyString(input.uri, '$.spec.source.uri', 4096);
  const revision = input.revision === undefined
    ? undefined
    : requireNonEmptyString(input.revision, '$.spec.source.revision', 512);
  return { kind, uri, ...(revision === undefined ? {} : { revision }) };
}

function validateFormatCapability(
  format: RenderFormatV1,
  value: unknown,
): RenderFormatCapabilityV1 {
  const path = `$.capability.formats.${format}`;
  const input = requireRecord(value, path);
  requireExactKeys(
    input,
    ['enabled', 'alphaModes', 'maxWidth', 'maxHeight'],
    ['enabled', 'alphaModes'],
    path,
  );
  const enabled = requireBoolean(input.enabled, `${path}.enabled`);
  if (!Array.isArray(input.alphaModes)) {
    throw new RenderArtifactValidationError(`${path}.alphaModes`, 'must be an array');
  }
  const allowedByContract = RENDER_FORMAT_RULES_V1[format].alphaModes;
  const declaredAlphaModes = input.alphaModes.map((mode, index) => requireOneOf(
    mode,
    [...allowedByContract],
    `${path}.alphaModes[${index}]`,
  ));
  if (new Set(declaredAlphaModes).size !== declaredAlphaModes.length) {
    throw new RenderArtifactValidationError(`${path}.alphaModes`, 'must not contain duplicates');
  }
  // Alpha support is a set. Normalize it to contract order so equivalent
  // capability declarations produce one renderer fingerprint.
  const declaredAlphaSet = new Set<RenderAlphaModeV1>(declaredAlphaModes);
  const alphaModes = allowedByContract.filter((mode) => declaredAlphaSet.has(mode));
  if (!enabled && alphaModes.length !== 0) {
    throw new RenderArtifactValidationError(`${path}.alphaModes`, 'must be empty when the format is disabled');
  }
  if (enabled && alphaModes.length === 0) {
    throw new RenderArtifactValidationError(`${path}.alphaModes`, 'must name at least one supported alpha mode');
  }

  if (RENDER_FORMAT_RULES_V1[format].kind === 'model') {
    if ('maxWidth' in input || 'maxHeight' in input) {
      throw new RenderArtifactValidationError(path, 'model formats must not declare raster dimensions');
    }
    return { enabled, alphaModes };
  }
  if (!enabled && ('maxWidth' in input || 'maxHeight' in input)) {
    throw new RenderArtifactValidationError(path, 'disabled raster formats must not declare dimensions');
  }
  if (!enabled) return { enabled, alphaModes };
  return {
    enabled,
    alphaModes,
    maxWidth: requireInteger(
      input.maxWidth,
      MIN_RASTER_DIMENSION_V1,
      MAX_RASTER_DIMENSION_V1,
      `${path}.maxWidth`,
    ),
    maxHeight: requireInteger(
      input.maxHeight,
      MIN_RASTER_DIMENSION_V1,
      MAX_RASTER_DIMENSION_V1,
      `${path}.maxHeight`,
    ),
  };
}

function validateLayerBooleanMap(
  value: unknown,
  path: string,
): RenderLayerStateV1 {
  const input = requireRecord(value, path);
  requireExactKeys(input, LAYER_IDS, LAYER_IDS, path);
  const layers = Object.fromEntries(LAYER_IDS.map((layer) => [
    layer,
    requireBoolean(input[layer], `${path}.${layer}`),
  ])) as Record<RenderLayerIdV1, boolean>;
  return layers;
}

function validateEnabledLayerStateV1(
  layers: RenderLayerStateV1,
  view: RenderJsonObjectV1,
): void {
  for (const layer of LAYER_IDS) {
    const entry = RENDER_LAYER_REGISTRY_V1[layer];
    if (layers[layer] && entry.support === 'unsupported') {
      throw new RenderArtifactValidationError(
        `$.spec.layers.${layer}`,
        `enabled layer ${layer} is unsupported by the V1 artifact contract`,
      );
    }
    if (entry.canonicalStateField === 'source-only') {
      if (entry.dataDigest !== 'source-content') {
        throw new Error(`Invalid V1 layer registry: source-only layer ${layer} is not source-content addressed`);
      }
      continue;
    }

    const stateField = entry.canonicalStateField.slice('view.'.length);
    const statePath = `$.spec.${entry.canonicalStateField}`;
    if (!layers[layer]) {
      if (stateField in view) {
        throw new RenderArtifactValidationError(
          statePath,
          `must be absent while layer ${layer} is disabled`,
        );
      }
      continue;
    }
    if (!(stateField in view)) {
      throw new RenderArtifactValidationError(
        statePath,
        `is required while layer ${layer} is enabled`,
      );
    }
    const state = requireRecord(view[stateField], statePath);
    if (Object.keys(state).length === 0) {
      throw new RenderArtifactValidationError(statePath, 'must contain explicit canonical layer state');
    }
    if (entry.dataDigest === 'separate-required') {
      requirePattern(state.dataDigest, SHA256_PATTERN, `${statePath}.dataDigest`);
    }
  }
}

/**
 * V1 is an applied render profile, not an arbitrary JSON bag. Exact keys keep
 * callers from hashing fields a renderer may ignore or omitting fields which
 * actually change pixels. Deeper enum/range policy can only narrow in a new
 * compatible profile; unknown present fields fail now.
 */
function validateRenderViewShapeV1(
  format: RenderFormatV1,
  layers: RenderLayerStateV1,
  view: RenderJsonObjectV1,
): void {
  const raster = RENDER_FORMAT_RULES_V1[format].kind === 'raster';
  const topLevel = raster ? ['camera', 'lighting', 'postprocess'] : [];
  for (const layer of LAYER_IDS) {
    const entry = RENDER_LAYER_REGISTRY_V1[layer];
    if (layers[layer] && entry.canonicalStateField !== 'source-only') {
      topLevel.push(entry.canonicalStateField.slice('view.'.length));
    }
  }
  requireExactKeys(view, topLevel, topLevel, '$.spec.view');

  if (raster) {
    const camera = exactViewObject(view, 'camera', ['position', 'target', 'fov', 'near', 'far']);
    requireFiniteTuple(camera.position, 3, '$.spec.view.camera.position');
    requireFiniteTuple(camera.target, 3, '$.spec.view.camera.target');
    requireNumberInRange(camera.fov, 1, 179, '$.spec.view.camera.fov');
    const near = requireFiniteNumber(camera.near, '$.spec.view.camera.near');
    const far = requireFiniteNumber(camera.far, '$.spec.view.camera.far');
    if (near <= 0) {
      throw new RenderArtifactValidationError('$.spec.view.camera.near', 'must be greater than zero');
    }
    if (far <= near) {
      throw new RenderArtifactValidationError('$.spec.view.camera.far', 'must be greater than camera.near');
    }

    const lighting = exactViewObject(view, 'lighting', [
      'ambient', 'directional', 'rim',
      'keyAzimuth', 'keyElevation', 'fillAzimuth', 'fillElevation', 'rimAzimuth', 'rimElevation',
      'fillColor', 'rimColor', 'environment',
    ]);
    requireNumberInRange(lighting.ambient, 0, 4, '$.spec.view.lighting.ambient');
    requireNumberInRange(lighting.directional, 0, 4, '$.spec.view.lighting.directional');
    requireNumberInRange(lighting.rim, 0, 4, '$.spec.view.lighting.rim');
    requireNumberInRange(lighting.keyAzimuth, -360, 360, '$.spec.view.lighting.keyAzimuth');
    requireNumberInRange(lighting.keyElevation, -90, 90, '$.spec.view.lighting.keyElevation');
    requireNumberInRange(lighting.fillAzimuth, -360, 360, '$.spec.view.lighting.fillAzimuth');
    requireNumberInRange(lighting.fillElevation, -90, 90, '$.spec.view.lighting.fillElevation');
    requireNumberInRange(lighting.rimAzimuth, -360, 360, '$.spec.view.lighting.rimAzimuth');
    requireNumberInRange(lighting.rimElevation, -90, 90, '$.spec.view.lighting.rimElevation');
    requireHexColor(lighting.fillColor, '$.spec.view.lighting.fillColor');
    requireHexColor(lighting.rimColor, '$.spec.view.lighting.rimColor');
    const environment = requireRecord(lighting.environment, '$.spec.view.lighting.environment');
    const environmentPreset = requireOneOf(
      environment.preset,
      ENVIRONMENT_PRESETS_V1,
      '$.spec.view.lighting.environment.preset',
    );
    requireExactKeys(
      environment,
      environmentPreset === 'none'
        ? ['preset']
        : ['preset', 'assetRevision', 'file', 'colorSpace'],
      environmentPreset === 'none'
        ? ['preset']
        : ['preset', 'assetRevision', 'file', 'colorSpace'],
      '$.spec.view.lighting.environment',
    );
    if (environmentPreset !== 'none') {
      requirePattern(environment.assetRevision, /^[0-9a-f]{40,64}$/, '$.spec.view.lighting.environment.assetRevision');
      requireNonEmptyString(environment.file, '$.spec.view.lighting.environment.file', 256);
      requireLiteral(environment.colorSpace, 'srgb-linear', '$.spec.view.lighting.environment.colorSpace');
    }

    const postprocess = exactViewObject(view, 'postprocess', [
      'pipeline', 'toneMapping', 'multisampling', 'outputColorSpace',
    ]);
    requireLiteral(postprocess.pipeline, 'raw-scene', '$.spec.view.postprocess.pipeline');
    requireLiteral(postprocess.toneMapping, 'none', '$.spec.view.postprocess.toneMapping');
    requireLiteral(postprocess.multisampling, 0, '$.spec.view.postprocess.multisampling');
    requireLiteral(postprocess.outputColorSpace, 'srgb', '$.spec.view.postprocess.outputColorSpace');
  }

  if (layers.background) {
    const background = requireRecord(view.background, '$.spec.view.background');
    const projectionMode = requireOneOf(
      background.projectionMode,
      ['scene-background', 'backdrop-mesh'] as const,
      '$.spec.view.background.projectionMode',
    );
    const base = ['top', 'bottom', 'media', 'style', 'projectionMode', 'dataDigest'];
    const mesh = [
      ...base,
      'opacity', 'brightness', 'saturation', 'contrast',
      'yawDegrees', 'pitchDegrees', 'backdropShape', 'backdropPattern', 'backdropRadius',
    ];
    requireExactKeys(
      background,
      projectionMode === 'scene-background' ? base : mesh,
      projectionMode === 'scene-background' ? base : mesh,
      '$.spec.view.background',
    );
    requireHexColor(background.top, '$.spec.view.background.top');
    requireHexColor(background.bottom, '$.spec.view.background.bottom');
    requireOneOf(background.style, ['linear', 'radial', 'spotlight'] as const, '$.spec.view.background.style');
    requirePattern(background.dataDigest, SHA256_PATTERN, '$.spec.view.background.dataDigest');
    const media = requireRecord(background.media, '$.spec.view.background.media');
    requireExactKeys(media, ['kind', 'projection'], ['kind', 'projection'], '$.spec.view.background.media');
    const mediaKind = requireOneOf(media.kind, ['gradient', 'image'] as const, '$.spec.view.background.media.kind');
    requireLiteral(media.projection, 'equirectangular', '$.spec.view.background.media.projection');
    if (projectionMode === 'scene-background' && mediaKind !== 'gradient') {
      throw new RenderArtifactValidationError(
        '$.spec.view.background.projectionMode',
        'scene-background requires gradient media in V1',
      );
    }
    if (projectionMode === 'backdrop-mesh') {
      requireNumberInRange(background.opacity, 0.15, 1, '$.spec.view.background.opacity');
      requireNumberInRange(background.brightness, 0.35, 1.8, '$.spec.view.background.brightness');
      requireNumberInRange(background.saturation, 0, 2, '$.spec.view.background.saturation');
      requireNumberInRange(background.contrast, 0.5, 1.8, '$.spec.view.background.contrast');
      requireNumberInRange(background.yawDegrees, -180, 180, '$.spec.view.background.yawDegrees');
      requireNumberInRange(background.pitchDegrees, -45, 45, '$.spec.view.background.pitchDegrees');
      requireOneOf(background.backdropShape, ['dome', 'sphere', 'cube'] as const, '$.spec.view.background.backdropShape');
      requireOneOf(background.backdropPattern, ['image', 'plain', 'grid'] as const, '$.spec.view.background.backdropPattern');
      requireNumberInRange(background.backdropRadius, 0.25, 5000, '$.spec.view.background.backdropRadius');
    }
  }

  if (layers.atoms) {
    const shared = [
      'scale', 'hiddenTypes', 'typeScales', 'colorSource', 'colorMode', 'colorProperty',
      'colormap', 'uniformColor', 'elementColorOverrides', 'materialPreset', 'roughness', 'polish',
      'propertyRange',
    ];
    const atoms = exactViewObject(
      view,
      'atoms',
      raster
        ? [...shared, 'propertyEmissionStrength', 'materialIntensity', 'texture', 'clearcoat']
        : [...shared, 'geometryPolicy'],
    );
    requireNumberInRange(atoms.scale, 0.1, 8, '$.spec.view.atoms.scale');
    requireIntegerArray(atoms.hiddenTypes, 1, 255, '$.spec.view.atoms.hiddenTypes');
    requireNumericRecord(atoms.typeScales, 0.1, 8, '$.spec.view.atoms.typeScales');
    requireOneOf(atoms.colorSource, ['colormap', 'element'] as const, '$.spec.view.atoms.colorSource');
    const colorMode = requireOneOf(atoms.colorMode, ['type', 'property', 'uniform'] as const, '$.spec.view.atoms.colorMode');
    requireNullableString(atoms.colorProperty, '$.spec.view.atoms.colorProperty', 64);
    if (colorMode === 'property' && atoms.colorProperty === null) {
      throw new RenderArtifactValidationError('$.spec.view.atoms.colorProperty', 'is required for property color mode');
    }
    requireOneOf(atoms.colormap, COLORMAPS_V1, '$.spec.view.atoms.colormap');
    requireHexColor(atoms.uniformColor, '$.spec.view.atoms.uniformColor');
    requireColorRecord(atoms.elementColorOverrides, '$.spec.view.atoms.elementColorOverrides');
    requireOneOf(atoms.materialPreset, MATERIAL_PRESETS_V1, '$.spec.view.atoms.materialPreset');
    requireNumberInRange(atoms.roughness, -1, 1, '$.spec.view.atoms.roughness');
    requireNumberInRange(atoms.polish, -1, 1, '$.spec.view.atoms.polish');
    requireOrderedFiniteTuple(atoms.propertyRange, 2, '$.spec.view.atoms.propertyRange');
    if (raster) {
      requireNumberInRange(atoms.propertyEmissionStrength, 0, 1, '$.spec.view.atoms.propertyEmissionStrength');
      requireNumberInRange(atoms.materialIntensity, 0, 1, '$.spec.view.atoms.materialIntensity');
      requireOneOf(atoms.texture, ['none', 'scratched', 'noise'] as const, '$.spec.view.atoms.texture');
      requireNumberInRange(atoms.clearcoat, 0, 1, '$.spec.view.atoms.clearcoat');
    } else {
      requireOneOf(
        atoms.geometryPolicy,
        ['glb-world-space-v1', 'usdz-ar-framed-v1'] as const,
        '$.spec.view.atoms.geometryPolicy',
      );
      const expectedGeometryPolicy = format === 'usdz' ? 'usdz-ar-framed-v1' : 'glb-world-space-v1';
      requireLiteral(atoms.geometryPolicy, expectedGeometryPolicy, '$.spec.view.atoms.geometryPolicy');
    }
  }

  if (layers.vectorGlyphs) {
    const vectorGlyphs = exactViewObject(view, 'vectorGlyphs', ['field', 'scale', 'density', 'colormap']);
    requireNonEmptyString(vectorGlyphs.field, '$.spec.view.vectorGlyphs.field', 64);
    requireNumberInRange(vectorGlyphs.scale, 0.1, 10, '$.spec.view.vectorGlyphs.scale');
    requireNumberInRange(vectorGlyphs.density, 0.01, 1, '$.spec.view.vectorGlyphs.density');
    requireOneOf(vectorGlyphs.colormap, COLORMAPS_V1, '$.spec.view.vectorGlyphs.colormap');
  }
  if (layers.bonds) {
    const shared = [
      'tolerance', 'atomColorSource', 'atomColorMode', 'colorProperty',
      'colormap', 'uniformColor', 'elementColorOverrides', 'materialPreset', 'roughness', 'polish',
      'execution',
    ];
    const bonds = exactViewObject(
      view,
      'bonds',
      raster ? [...shared, 'colorMode', 'materialIntensity', 'clearcoat', 'appliedCount'] : shared,
    );
    requireNumberInRange(bonds.tolerance, 0, 1.5, '$.spec.view.bonds.tolerance');
    requireOneOf(bonds.atomColorSource, ['colormap', 'element'] as const, '$.spec.view.bonds.atomColorSource');
    requireOneOf(bonds.atomColorMode, ['type', 'property', 'uniform'] as const, '$.spec.view.bonds.atomColorMode');
    requireNullableString(bonds.colorProperty, '$.spec.view.bonds.colorProperty', 64);
    requireOneOf(bonds.colormap, COLORMAPS_V1, '$.spec.view.bonds.colormap');
    requireHexColor(bonds.uniformColor, '$.spec.view.bonds.uniformColor');
    requireColorRecord(bonds.elementColorOverrides, '$.spec.view.bonds.elementColorOverrides');
    requireOneOf(bonds.materialPreset, MATERIAL_PRESETS_V1, '$.spec.view.bonds.materialPreset');
    requireNumberInRange(bonds.roughness, -1, 1, '$.spec.view.bonds.roughness');
    requireNumberInRange(bonds.polish, -1, 1, '$.spec.view.bonds.polish');
    requireOneOf(
      bonds.execution,
      ['cpu-export-v1', 'cpu-snapshot-v1'] as const,
      '$.spec.view.bonds.execution',
    );
    if (raster) {
      requireOneOf(bonds.colorMode, ['type', 'length', 'energy', 'screening'] as const, '$.spec.view.bonds.colorMode');
      requireNumberInRange(bonds.materialIntensity, 0, 1, '$.spec.view.bonds.materialIntensity');
      requireNumberInRange(bonds.clearcoat, 0, 1, '$.spec.view.bonds.clearcoat');
      requireInteger(bonds.appliedCount, 0, 100_000_000, '$.spec.view.bonds.appliedCount');
    }
  }
  if (layers.filterShell) {
    const filterShell = exactViewObject(view, 'filterShell', ['shape', 'preset', 'opacity', 'radiusScale']);
    requireOneOf(filterShell.shape, ['sphere', 'cube'] as const, '$.spec.view.filterShell.shape');
    requireOneOf(filterShell.preset, ['haze', 'cryo', 'prism', 'graphite'] as const, '$.spec.view.filterShell.preset');
    requireNumberInRange(filterShell.opacity, 0, 0.65, '$.spec.view.filterShell.opacity');
    requireNumberInRange(filterShell.radiusScale, 0.75, 4, '$.spec.view.filterShell.radiusScale');
  }
  if (layers.moleculeShadow) {
    const moleculeShadow = exactViewObject(view, 'moleculeShadow', ['opacity', 'keyAzimuth', 'keyElevation']);
    requireNumberInRange(moleculeShadow.opacity, 0, 1, '$.spec.view.moleculeShadow.opacity');
    requireNumberInRange(moleculeShadow.keyAzimuth, -360, 360, '$.spec.view.moleculeShadow.keyAzimuth');
    requireNumberInRange(moleculeShadow.keyElevation, -90, 90, '$.spec.view.moleculeShadow.keyElevation');
  }
  if (layers.contactShadows) {
    const contactShadows = exactViewObject(view, 'contactShadows', ['blur', 'opacity', 'resolution', 'color']);
    requireNumberInRange(contactShadows.blur, 0, 100, '$.spec.view.contactShadows.blur');
    requireNumberInRange(contactShadows.opacity, 0, 1, '$.spec.view.contactShadows.opacity');
    requireInteger(contactShadows.resolution, 64, 4096, '$.spec.view.contactShadows.resolution');
    requireHexColor(contactShadows.color, '$.spec.view.contactShadows.color');
  }
  if (layers.axes) {
    const axes = exactViewObject(view, 'axes', [
      'kind', 'alignment', 'radiusPolicy', 'axisColors', 'labelColor',
    ]);
    requireLiteral(axes.kind, 'canvas-overlay-v1', '$.spec.view.axes.kind');
    requireLiteral(axes.alignment, 'bottom-left', '$.spec.view.axes.alignment');
    requireLiteral(axes.radiusPolicy, '11pct-clamped-18-42', '$.spec.view.axes.radiusPolicy');
    requireExactColorArray(
      axes.axisColors,
      ['#ff4060', '#40ff80', '#4080ff'],
      '$.spec.view.axes.axisColors',
    );
    requireLiteral(axes.labelColor, 'white', '$.spec.view.axes.labelColor');
  }
}

function exactViewObject(
  view: RenderJsonObjectV1,
  field: string,
  keys: readonly string[],
): Record<string, unknown> {
  const path = `$.spec.view.${field}`;
  const value = requireRecord(view[field], path);
  requireExactKeys(value, keys, keys, path);
  return value;
}

function requireFiniteTuple(value: unknown, length: number, path: string): readonly number[] {
  if (
    !Array.isArray(value)
    || value.length !== length
    || !value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  ) {
    throw new RenderArtifactValidationError(path, `must contain exactly ${length} finite numbers`);
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RenderArtifactValidationError(path, 'must be a finite number');
  }
  return value;
}

function requireNumberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  const number = requireFiniteNumber(value, path);
  if (number < minimum || number > maximum) {
    throw new RenderArtifactValidationError(path, `must be from ${minimum} through ${maximum}`);
  }
  return number;
}

function requireOrderedFiniteTuple(value: unknown, length: number, path: string): readonly number[] {
  const tuple = requireFiniteTuple(value, length, path);
  for (let index = 1; index < tuple.length; index += 1) {
    if (tuple[index] < tuple[index - 1]) {
      throw new RenderArtifactValidationError(path, 'must be ordered from low to high');
    }
  }
  return tuple;
}

function requireIntegerArray(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): readonly number[] {
  if (!Array.isArray(value)) {
    throw new RenderArtifactValidationError(path, 'must be an array');
  }
  const seen = new Set<number>();
  for (let index = 0; index < value.length; index += 1) {
    const item = requireInteger(value[index], minimum, maximum, `${path}[${index}]`);
    if (seen.has(item)) throw new RenderArtifactValidationError(path, 'must not contain duplicates');
    seen.add(item);
  }
  return value as number[];
}

function requireNumericRecord(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): Record<string, unknown> {
  const record = requireRecord(value, path);
  for (const [key, entry] of Object.entries(record)) {
    if (!/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(key)) {
      throw new RenderArtifactValidationError(`${path}.${key}`, 'key must be an atomic number from 1 through 255');
    }
    requireNumberInRange(entry, minimum, maximum, `${path}.${key}`);
  }
  return record;
}

function requireColorRecord(value: unknown, path: string): Record<string, unknown> {
  const record = requireRecord(value, path);
  for (const [key, entry] of Object.entries(record)) {
    if (!/^(?:[1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/.test(key)) {
      throw new RenderArtifactValidationError(`${path}.${key}`, 'key must be an atomic number from 1 through 255');
    }
    requireHexColor(entry, `${path}.${key}`);
  }
  return record;
}

function requireNullableString(value: unknown, path: string, maxLength: number): string | null {
  if (value === null) return null;
  return requireNonEmptyString(value, path, maxLength);
}

function requireHexColor(value: unknown, path: string): string {
  return requirePattern(value, HEX_COLOR_PATTERN_V1, path);
}

function requireExactColorArray(
  value: unknown,
  expected: readonly string[],
  path: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length !== expected.length) {
    throw new RenderArtifactValidationError(path, `must contain exactly ${expected.length} colors`);
  }
  for (let index = 0; index < expected.length; index += 1) {
    requireLiteral(value[index], expected[index], `${path}[${index}]`);
  }
  return value as string[];
}

function normalizeJsonObject(value: unknown, path: string): RenderJsonObjectV1 {
  const input = requireRecord(value, path);
  canonicalize(value, path, new WeakSet<object>());
  return normalizeJsonValue(input) as RenderJsonObjectV1;
}

function normalizeJsonValue(value: unknown): RenderJsonValueV1 {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'number' && Object.is(value, -0)
      ? 0
      : value as RenderJsonPrimitiveV1;
  }
  if (Array.isArray(value)) return value.map((entry) => normalizeJsonValue(entry));
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, normalizeJsonValue(record[key])]),
  );
}

function canonicalize(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RenderArtifactValidationError(path, 'must be a finite JSON number');
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw new RenderArtifactValidationError(path, `unsupported canonical value ${typeof value}`);
  }
  if (ancestors.has(value)) {
    throw new RenderArtifactValidationError(path, 'must not contain a cycle');
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry, index) => canonicalize(entry, `${path}[${index}]`, ancestors)).join(',')}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RenderArtifactValidationError(path, 'must be a plain JSON object');
    }
    const record = value as Record<string, unknown>;
    if (Object.getOwnPropertySymbols(record).length > 0) {
      throw new RenderArtifactValidationError(path, 'must not contain symbol keys');
    }
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(record))) {
      if (!descriptor.enumerable || descriptor.get || descriptor.set) {
        throw new RenderArtifactValidationError(
          `${path}.${key}`,
          'must be an enumerable data property',
        );
      }
    }
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalize(record[key], `${path}.${key}`, ancestors)}`
    )).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new RenderArtifactValidationError(path, 'must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new RenderArtifactValidationError(path, 'must be a plain object');
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    throw new RenderArtifactValidationError(path, `contains unsupported field ${unknown.sort()[0]}`);
  }
  const missing = required.filter((key) => !(key in input));
  if (missing.length > 0) {
    throw new RenderArtifactValidationError(path, `is missing required field ${missing[0]}`);
  }
}

function requireLiteral<T extends string | number | boolean>(value: unknown, expected: T, path: string): T {
  if (value !== expected) throw new RenderArtifactValidationError(path, `must equal ${expected}`);
  return expected;
}

function requireOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new RenderArtifactValidationError(path, `must be one of ${allowed.join(', ')}`);
  }
  return value as T[number];
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new RenderArtifactValidationError(path, 'must be a boolean');
  return value;
}

function requireInteger(value: unknown, min: number, max: number, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new RenderArtifactValidationError(path, `must be an integer from ${min} through ${max}`);
  }
  return value as number;
}

function requireNonEmptyString(value: unknown, path: string, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.length > maxLength) {
    throw new RenderArtifactValidationError(path, `must be a non-empty trimmed string of at most ${maxLength} characters`);
  }
  return value;
}

function requireIdentifier(value: unknown, path: string): string {
  const identifier = requireNonEmptyString(value, path, 256);
  if (/\p{C}/u.test(identifier)) {
    throw new RenderArtifactValidationError(path, 'must not contain control characters');
  }
  return identifier;
}

function requireMediaType(value: unknown, path: string): string {
  const mediaType = requireNonEmptyString(value, path, 256).toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;\s*[a-z0-9!#$&^_.+-]+=[^;]+)*$/.test(mediaType)) {
    throw new RenderArtifactValidationError(path, 'must be a valid media type');
  }
  return mediaType;
}

function requireFilename(value: unknown, path: string): string {
  const filename = requireNonEmptyString(value, path, 255);
  if (/[\\/\0-\x1f\x7f]/.test(filename) || filename === '.' || filename === '..') {
    throw new RenderArtifactValidationError(path, 'must be a basename without path separators or control characters');
  }
  return filename;
}

function requirePattern(value: unknown, pattern: RegExp, path: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new RenderArtifactValidationError(path, 'has an invalid SHA-256 identifier');
  }
  return value;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function copyBytes(content: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (content instanceof ArrayBuffer) return new Uint8Array(content.slice(0));
  return Uint8Array.from(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is unavailable in this runtime');
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
