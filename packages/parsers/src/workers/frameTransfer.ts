import type { FrameIdentity } from '@atlas/core/types';

type WorkerFrameLike = {
  propertyNames?: string[] | (() => string[]);
  getProperty?: (name: string) => Float32Array | null | undefined;
  properties?: Map<string, Float32Array> | Array<[string, Float32Array]>;
  identity?: Partial<FrameIdentity> | null;
};

export type WorkerFrameProperty = { name: string; data: Float32Array };

/** Keep identity explicit across structured-clone worker messages. Legacy
 * WASM frames that do not declare provenance remain unknown; IDs alone are
 * never enough evidence to upgrade them to stable source identity. */
export function extractFrameIdentity(frame: WorkerFrameLike): FrameIdentity {
  const identity = frame.identity;
  if (
    identity &&
    (identity.kind === 'source-id' || identity.kind === 'synthetic-row' || identity.kind === 'unknown') &&
    typeof identity.unique === 'boolean'
  ) {
    return { kind: identity.kind, unique: identity.unique };
  }
  return { kind: 'unknown', unique: false };
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
