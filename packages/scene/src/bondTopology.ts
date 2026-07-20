/** CPU source pairs are authoritative; WebGPU is only an inference backend. */
export function shouldUseGpuBondInference(
  natoms: number,
  sourceBonds: Int32Array | null | undefined,
  gpuRequested: boolean,
  forceGpuAtomThreshold = 200_000,
): boolean {
  if (sourceBonds && sourceBonds.length > 0) return false;
  return gpuRequested || natoms > forceGpuAtomThreshold;
}
