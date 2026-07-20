import { normalizeAtomTypeSemantics, normalizeDistanceSemantics } from '@atlas/core';
import type {
  AtomTypeSemantics,
  DistanceSemantics,
  FrameIdentity,
} from '@atlas/core/types';

type WorkerFrameLike = {
  propertyNames?: string[] | (() => string[]);
  getProperty?: (name: string) => Float32Array | null | undefined;
  properties?: Map<string, Float32Array> | Array<[string, Float32Array]>;
  identity?: Partial<FrameIdentity> | null;
  typeSemantics?: AtomTypeSemantics | null;
  distanceSemantics?: DistanceSemantics | null;
};

export type WorkerFrameProperty = { name: string; data: Float32Array };

/** Keep identity explicit across structured-clone worker messages. Legacy
 * WASM frames that do not declare provenance remain unknown; IDs alone are
 * never enough evidence to upgrade them to stable source identity. */
export function extractFrameIdentity(frame: WorkerFrameLike): FrameIdentity {
  const identity = frame.identity;
  if (
    identity &&
    (identity.kind === 'source-id' || identity.kind === 'source-order' || identity.kind === 'synthetic-row' || identity.kind === 'unknown') &&
    typeof identity.unique === 'boolean'
  ) {
    return { kind: identity.kind, unique: identity.unique };
  }
  return { kind: 'unknown', unique: false };
}

/** Normalize optional structured-cloned scientific metadata. Missing legacy
 * fields stay explicitly opaque/unknown rather than inheriting UI defaults. */
export function extractFrameTypeSemantics(frame: WorkerFrameLike): AtomTypeSemantics {
  return normalizeAtomTypeSemantics(frame.typeSemantics ?? undefined);
}

export function extractFrameDistanceSemantics(frame: WorkerFrameLike): DistanceSemantics {
  return normalizeDistanceSemantics(frame.distanceSemantics ?? undefined);
}

/** XYZ rows carry element tokens and synthetic row-order IDs. Coordinates are
 * conventionally interpreted as angstroms, which is weaker than a source unit
 * declaration and remains visible in provenance. */
export function xyzFrameMetadata(): {
  identity: FrameIdentity;
  typeSemantics: AtomTypeSemantics;
  distanceSemantics: DistanceSemantics;
} {
  return {
    identity: { kind: 'synthetic-row', unique: true },
    typeSemantics: { kind: 'atomic-number', provenance: 'xyz-element-token' },
    distanceSemantics: { kind: 'angstrom', provenance: 'format-convention' },
  };
}

/** LAMMPS data coordinates do not encode the simulation's unit style. A
 * complete Masses-table resolution may support element display, but remains
 * explicitly inferred rather than source-declared chemistry. */
export function lammpsDataSemantics(hasCompleteMassMapping: boolean): {
  typeSemantics: AtomTypeSemantics;
  distanceSemantics: DistanceSemantics;
} {
  return {
    typeSemantics: hasCompleteMassMapping
      ? { kind: 'atomic-number', provenance: 'lammps-masses-inferred' }
      : { kind: 'opaque', provenance: 'lammps-type-id' },
    distanceSemantics: { kind: 'unknown', provenance: 'lammps-data' },
  };
}

/** Normalize canonical Map properties and legacy WASM tuple properties. */
export function extractFrameProperties(
  frame: WorkerFrameLike,
  transferables: Transferable[],
): WorkerFrameProperty[] {
  if (frame.properties instanceof Map) {
    return Array.from(frame.properties, ([name, data]) => {
      transferables.push(data.buffer);
      return { name, data };
    });
  }

  const propertyNames = typeof frame.propertyNames === 'function'
    ? frame.propertyNames()
    : Array.isArray(frame.propertyNames) ? frame.propertyNames : null;
  if (propertyNames && frame.getProperty) {
    return propertyNames.flatMap((name) => {
      const data = frame.getProperty!(name);
      if (!data) return [];
      transferables.push(data.buffer);
      return [{ name, data }];
    });
  }

  if (!Array.isArray(frame.properties)) return [];
  return frame.properties.map(([name, data]) => {
    transferables.push(data.buffer);
    return { name, data };
  });
}
