import {
  computeRenderArtifactDigestV1,
  detectFrameVectorFields,
  getVectorComponents,
  normalizeAtomTypeSemantics,
  normalizeDistanceSemantics,
  type AtomTypeSemantics,
  type DistanceSemantics,
  type Frame,
  type Sha256DigestV1,
} from '@atlas/core';

export const DECODED_RENDER_FRAME_MEDIA_TYPE_V1 = 'application/vnd.lupi.decoded-frame.v1';
export const DECODED_RENDER_FRAME_MEDIA_TYPE_V2 = 'application/vnd.lupi.decoded-frame.v2';
export const DECODED_RENDER_FRAME_MEDIA_TYPE_V3 = 'application/vnd.lupi.decoded-frame.v3';

const CANONICAL_FRAME_VERSION_V1 = 'lupi.decoded-render-frame.v1';
const CANONICAL_FRAME_VERSION_V2 = 'lupi.decoded-render-frame.v2';
const CANONICAL_FRAME_VERSION_V3 = 'lupi.decoded-render-frame.v3';
const textEncoder = new TextEncoder();

/**
 * Encode the decoded source fields that browser rendering can consume.
 *
 * This deliberately excludes LoadedFile metadata such as name, byte length,
 * and sourceUrl. The format is length-delimited, little-endian, and rejects
 * partial/non-finite frames so the digest cannot depend on host object layout
 * or attacker-controlled provenance labels.
 */
export function canonicalDecodedRenderFrameBytesV1(frame: Frame): Uint8Array {
  validateFrame(frame);

  const writer = new CanonicalFrameWriter();
  writer.string(CANONICAL_FRAME_VERSION_V1);
  writer.u32(frame.natoms);
  writer.f64(frame.timestep, '$.frame.timestep');
  writer.bool(frame.triclinic);
  writer.f64Array(frame.boxBounds, '$.frame.boxBounds');
  writer.f64Array(frame.boxTilt, '$.frame.boxTilt');
  writer.i32Array(frame.ids.subarray(0, frame.natoms));
  writer.i32Array(frame.types.subarray(0, frame.natoms));
  writer.f32Array(frame.positions.subarray(0, frame.natoms * 3), '$.frame.positions');
  writer.i32Array(frame.bonds);

  const redundantMagnitudeProperties = deterministicDerivedMagnitudeProperties(frame);
  const properties = [...frame.properties.entries()]
    .filter(([name]) => !redundantMagnitudeProperties.has(name))
    .sort(([left], [right]) => (
      left < right ? -1 : left > right ? 1 : 0
    ));
  writer.u32(properties.length);
  for (const [name, values] of properties) {
    if (!name || name.length > 1024 || /\p{C}/u.test(name)) {
      throw new Error('$.frame.properties: property names must be non-empty, bounded, and contain no control characters');
    }
    writer.string(name);
    writer.f32Array(values, `$.frame.properties.${name}`);
  }

  return writer.finish();
}

/**
 * V2 binds decoded bytes to atom identity. This published layout is immutable;
 * scientific type and distance semantics were added in V3.
 */
export function canonicalDecodedRenderFrameBytesV2(frame: Frame): Uint8Array {
  const identity = normalizedFrameIdentity(frame);
  const writer = new CanonicalFrameWriter();
  writer.string(CANONICAL_FRAME_VERSION_V2);
  writer.string(identity.kind);
  writer.bool(identity.unique);
  writer.bytes(canonicalDecodedRenderFrameBytesV1(frame));
  return writer.finish();
}

/**
 * V3 binds the immutable V2 body to atom-type interpretation and coordinate
 * distance meaning, preventing numerically identical frames with different
 * scientific semantics from sharing a content digest.
 */
export function canonicalDecodedRenderFrameBytesV3(frame: Frame): Uint8Array {
  const typeSemantics = normalizedAtomTypeSemantics(frame);
  const distanceSemantics = normalizedDistanceSemantics(frame);
  const writer = new CanonicalFrameWriter();
  writer.string(CANONICAL_FRAME_VERSION_V3);
  writer.string(typeSemantics.kind);
  writer.string(typeSemantics.provenance);
  const elementMap = typeSemantics.kind === 'explicit-element-map'
    ? sortedElementMap(typeSemantics.elementMap)
    : [];
  writer.u32(elementMap.length);
  for (const [rawType, atomicNumber] of elementMap) {
    writer.i32(rawType, '$.frame.typeSemantics.elementMap key');
    writer.i32(atomicNumber, `$.frame.typeSemantics.elementMap.${rawType}`);
  }
  writer.string(distanceSemantics.kind);
  writer.string(distanceSemantics.provenance);
  writer.bytes(canonicalDecodedRenderFrameBytesV2(frame));
  return writer.finish();
}

/**
 * `ensureVectorMagnitude` memoizes a deterministic projection into the mutable
 * property map. Exclude only caches whose Float32 values exactly match a fresh
 * projection from source components; the components remain hashed, while the
 * selected field/property remains part of the render spec.
 */
export function deterministicDerivedMagnitudeProperties(frame: Frame): ReadonlySet<string> {
  const derived = new Set<string>();
  for (const field of detectFrameVectorFields(frame)) {
    const magnitude = frame.properties.get(field.magnitudeProperty);
    const components = getVectorComponents(frame, field);
    if (!magnitude || !components || magnitude.length !== frame.natoms) continue;
    const [x, y, z] = components;
    let exact = true;
    for (let index = 0; index < frame.natoms; index += 1) {
      const recomputed = Math.fround(Math.hypot(x[index], y[index], z[index]));
      if (magnitude[index] !== recomputed) {
        exact = false;
        break;
      }
    }
    if (exact) derived.add(field.magnitudeProperty);
  }
  return derived;
}

/** SHA-256 of canonical decoded content, never file name, URL, or caller metadata. */
export async function computeDecodedRenderFrameDigestV1(frame: Frame): Promise<Sha256DigestV1> {
  return computeRenderArtifactDigestV1(canonicalDecodedRenderFrameBytesV1(frame));
}

export async function computeDecodedRenderFrameDigestV2(frame: Frame): Promise<Sha256DigestV1> {
  return computeRenderArtifactDigestV1(canonicalDecodedRenderFrameBytesV2(frame));
}

export async function computeDecodedRenderFrameDigestV3(frame: Frame): Promise<Sha256DigestV1> {
  return computeRenderArtifactDigestV1(canonicalDecodedRenderFrameBytesV3(frame));
}

function normalizedFrameIdentity(frame: Frame): { kind: 'source-id' | 'source-order' | 'synthetic-row' | 'unknown'; unique: boolean } {
  const identity = frame.identity;
  if (!identity) return { kind: 'unknown', unique: false };
  if (
    identity.kind !== 'source-id'
    && identity.kind !== 'source-order'
    && identity.kind !== 'synthetic-row'
    && identity.kind !== 'unknown'
  ) {
    throw new Error('$.frame.identity.kind: unsupported atom identity semantics');
  }
  if (typeof identity.unique !== 'boolean') {
    throw new Error('$.frame.identity.unique: must be a boolean');
  }
  return { kind: identity.kind, unique: identity.unique };
}

function normalizedAtomTypeSemantics(frame: Frame): AtomTypeSemantics {
  const semantics = normalizeAtomTypeSemantics(frame.typeSemantics);
  if (semantics.kind === 'atomic-number') {
    if (![
      'source-element-symbol',
      'xyz-element-token',
      'lammps-masses-inferred',
      'procedural-symbol',
      'mlip-symbol',
      'mlip-material-id-inferred',
    ].includes(semantics.provenance)) {
      throw new Error('$.frame.typeSemantics.provenance: unsupported atomic-number provenance');
    }
    return semantics;
  }
  if (semantics.kind === 'explicit-element-map') {
    if (!['lammps-element-column', 'user-type-map'].includes(semantics.provenance)) {
      throw new Error('$.frame.typeSemantics.provenance: unsupported element-map provenance');
    }
    return semantics;
  }
  if (semantics.kind === 'opaque') {
    if (!['lammps-type-id', 'legacy-unknown'].includes(semantics.provenance)) {
      throw new Error('$.frame.typeSemantics.provenance: unsupported opaque provenance');
    }
    return semantics;
  }
  throw new Error('$.frame.typeSemantics.kind: unsupported atom-type semantics');
}

function normalizedDistanceSemantics(frame: Frame): DistanceSemantics {
  const semantics = normalizeDistanceSemantics(frame.distanceSemantics);
  if (semantics.kind === 'angstrom') {
    if (!['source-declared', 'format-convention', 'procedural'].includes(semantics.provenance)) {
      throw new Error('$.frame.distanceSemantics.provenance: unsupported angstrom provenance');
    }
    return semantics;
  }
  if (semantics.kind === 'unknown') {
    if (!['lammps-dump', 'lammps-data', 'legacy-unknown'].includes(semantics.provenance)) {
      throw new Error('$.frame.distanceSemantics.provenance: unsupported unknown provenance');
    }
    return semantics;
  }
  throw new Error('$.frame.distanceSemantics.kind: unsupported distance semantics');
}

function sortedElementMap(
  elementMap: Readonly<Record<number, number>>,
): Array<readonly [number, number]> {
  if (!elementMap || typeof elementMap !== 'object' || Array.isArray(elementMap)) {
    throw new Error('$.frame.typeSemantics.elementMap: must be an integer map');
  }
  const entries = Object.entries(elementMap).map(([rawTypeText, atomicNumber]) => {
    const rawType = Number(rawTypeText);
    if (String(rawType) !== rawTypeText) {
      throw new Error('$.frame.typeSemantics.elementMap: keys must be canonical integers');
    }
    assertI32(rawType, '$.frame.typeSemantics.elementMap key');
    assertI32(atomicNumber, `$.frame.typeSemantics.elementMap.${rawTypeText}`);
    return [rawType, atomicNumber] as const;
  });
  entries.sort(([left], [right]) => left - right);
  return entries;
}

function validateFrame(frame: Frame): void {
  if (!Number.isSafeInteger(frame.natoms) || frame.natoms < 1) {
    throw new Error('$.frame.natoms: must be a positive safe integer');
  }
  if (frame.ids.length < frame.natoms) {
    throw new Error('$.frame.ids: does not contain every decoded atom');
  }
  if (frame.types.length < frame.natoms) {
    throw new Error('$.frame.types: does not contain every decoded atom');
  }
  if (frame.positions.length < frame.natoms * 3) {
    throw new Error('$.frame.positions: does not contain xyz coordinates for every decoded atom');
  }
  if (frame.boxBounds.length !== 6) {
    throw new Error('$.frame.boxBounds: must contain x/y/z lower and upper bounds');
  }
  if (frame.boxTilt.length !== 3) {
    throw new Error('$.frame.boxTilt: must contain xy/xz/yz tilt factors');
  }
  if (frame.bonds.length % 2 !== 0) {
    throw new Error('$.frame.bonds: must contain complete atom-index pairs');
  }
  for (const [name, values] of frame.properties) {
    if (!(values instanceof Float32Array) || values.length !== frame.natoms) {
      throw new Error(`$.frame.properties.${name}: must contain one Float32 value per atom`);
    }
  }
}

class CanonicalFrameWriter {
  private readonly chunks: Uint8Array[] = [];
  private byteLength = 0;

  string(value: string): void {
    const bytes = textEncoder.encode(value);
    this.u32(bytes.byteLength);
    this.push(bytes);
  }

  bool(value: boolean): void {
    this.push(Uint8Array.of(value ? 1 : 0));
  }

  u32(value: number): void {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('Canonical frame value exceeds unsigned 32-bit range');
    }
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.push(bytes);
  }

  f64(value: number, path: string): void {
    assertFinite(value, path);
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, normalizeZero(value), true);
    this.push(bytes);
  }

  i32Array(values: Int32Array): void {
    this.u32(values.length);
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
      view.setInt32(index * 4, values[index], true);
    }
    this.push(bytes);
  }

  f32Array(values: Float32Array, path: string): void {
    this.u32(values.length);
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      assertFinite(value, `${path}[${index}]`);
      view.setFloat32(index * 4, normalizeZero(value), true);
    }
    this.push(bytes);
  }

  f64Array(values: Float64Array, path: string): void {
    this.u32(values.length);
    const bytes = new Uint8Array(values.length * 8);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      assertFinite(value, `${path}[${index}]`);
      view.setFloat64(index * 8, normalizeZero(value), true);
    }
    this.push(bytes);
  }

  i32(value: number, path: string): void {
    assertI32(value, path);
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    this.push(bytes);
  }

  bytes(values: Uint8Array): void {
    this.u32(values.byteLength);
    this.push(values);
  }

  finish(): Uint8Array {
    const result = new Uint8Array(this.byteLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  private push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.byteLength += bytes.byteLength;
  }
}

function assertFinite(value: number, path: string): void {
  if (!Number.isFinite(value)) throw new Error(`${path}: must be finite`);
}

function assertI32(value: number, path: string): void {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new Error(`${path}: must be a signed 32-bit integer`);
  }
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
