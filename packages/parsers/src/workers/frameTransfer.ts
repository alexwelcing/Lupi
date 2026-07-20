type WorkerFrameLike = {
  propertyNames?: string[] | (() => string[]);
  getProperty?: (name: string) => Float32Array | null | undefined;
  properties?: Map<string, Float32Array> | Array<[string, Float32Array]>;
};

export type WorkerFrameProperty = { name: string; data: Float32Array };

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
