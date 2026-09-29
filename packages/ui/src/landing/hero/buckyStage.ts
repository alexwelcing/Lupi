/**
 * buckyStage.ts — the framework-free ink C60 used by the home hero and the
 * relay stage. WP0 stub: a still image of the buckyball.
 */
export type Vec3 = [number, number, number];

/** Radians; camera azimuth about world +Y and elevation. */
export interface BuckyPose {
  azimuth: number;
  elevation: number;
}

export interface BuckyStage {
  setPose(pose: BuckyPose): void;
  getPose(): BuckyPose;
  /** The molecule's apparent spin about world +Y (rad/s). */
  getBodyOmegaY(): number;
  /** Unit view direction (camera from target). */
  viewDir(): Vec3;
  destroy(): void;
}

export interface BuckyStageOptions {
  size: number;
  pose?: BuckyPose;
  interactive: boolean;
  onTap?(): void;
  onDetent?(label: string): void;
  onSpinDegrees?(total: number): void;
}

export function createBuckyStage(host: HTMLElement, opts: BuckyStageOptions): BuckyStage {
  let pose: BuckyPose = opts.pose ? { ...opts.pose } : { azimuth: 0, elevation: 0 };
  const img = document.createElement('img');
  img.src = '/learn/c60_buckyball.svg';
  img.alt = '';
  img.width = opts.size;
  img.height = opts.size;
  img.draggable = false;
  host.appendChild(img);
  return {
    setPose(next) {
      pose = { ...next };
    },
    getPose() {
      return { ...pose };
    },
    getBodyOmegaY() {
      return 0;
    },
    viewDir() {
      const c = Math.cos(pose.elevation);
      return [c * Math.sin(pose.azimuth), Math.sin(pose.elevation), c * Math.cos(pose.azimuth)];
    },
    destroy() {
      img.remove();
    },
  };
}
