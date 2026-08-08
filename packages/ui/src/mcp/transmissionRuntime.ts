import type { TransmissionQuality } from '@atlas/scene';

/**
 * Execution-class receipt for the transmission renderer.
 *
 * MeshTransmissionMaterial's samples/resolution knobs are derived from the
 * device quality tier and change raster bytes. The tier itself is resolved
 * from live device signals at viewer mount, so re-deriving it at export time
 * could disagree with what the mounted renderer actually used. Instead, the
 * viewer reports the EFFECTIVE quality whenever the transmission renderer is
 * active, and the renderer fingerprint includes that receipt — two
 * executions with different transmission settings can never share an
 * artifact key (AGENTS.md: rendererFingerprint hashes the execution class
 * which can change bytes).
 */
let activeQuality: TransmissionQuality | null = null;

/** Called by the viewer when the transmission renderer mounts/unmounts. */
export function reportActiveTransmissionQuality(quality: TransmissionQuality | null): void {
  activeQuality = quality;
}

/**
 * Fingerprint contribution. 'inactive' when the transmission renderer is not
 * mounted, so non-transmission renders keep one stable execution class across
 * device tiers.
 */
export function activeTransmissionQualityV1():
  | { samples: number; resolution: number }
  | 'inactive' {
  return activeQuality
    ? { samples: activeQuality.samples, resolution: activeQuality.resolution }
    : 'inactive';
}
