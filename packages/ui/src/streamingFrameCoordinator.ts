import type { Frame } from '@atlas/core/types';
import { useStore } from './store';

type StreamingFrameSource = {
  fetchFrame: (frameIndex: number) => Promise<Frame>;
  dispose?: () => void;
};

type RequestStreamingFrame = (frameIndex: number, direction?: number, lookahead?: number) => void;

declare global {
  interface Window {
    __atlasStreamingCleanup?: () => void;
    __atlasRequestStreamingFrame?: RequestStreamingFrame;
  }
}

type InstallOptions = {
  label: string;
  sourceUrl?: string;
  name?: string;
  initialLookahead?: number;
  playbackLookahead?: number;
  idleLookahead?: number;
};

function getWindow(): Window | null {
  return typeof window === 'undefined' ? null : window;
}

function matchesActiveFile(sourceUrl?: string, name?: string): boolean {
  const file = useStore.getState().file;
  if (!file) return false;
  if (sourceUrl) return file.sourceUrl === sourceUrl;
  if (name) return file.name === name;
  return true;
}

function clampLookaheadForActiveFile(lookahead: number): number {
  const frames = useStore.getState().file?.trajectory.frames;
  const firstFrame = frames?.find(Boolean);
  const natoms = firstFrame?.natoms ?? 0;
  if (natoms >= 250_000) return Math.min(lookahead, 2);
  if (natoms >= 75_000) return Math.min(lookahead, 4);
  if (natoms >= 25_000) return Math.min(lookahead, 8);
  return lookahead;
}

export function clearStreamingFrameCoordinator(): void {
  const w = getWindow();
  if (!w) return;
  if (typeof w.__atlasStreamingCleanup === 'function') w.__atlasStreamingCleanup();
  delete w.__atlasStreamingCleanup;
  delete w.__atlasRequestStreamingFrame;
}

export function requestStreamingFrame(frameIndex: number, direction = 1, lookahead = 0): void {
  getWindow()?.__atlasRequestStreamingFrame?.(frameIndex, direction, lookahead);
}

export function installStreamingFrameCoordinator(
  source: StreamingFrameSource,
  options: InstallOptions,
): () => void {
  clearStreamingFrameCoordinator();

  const {
    label,
    sourceUrl,
    name,
    initialLookahead = 10,
    playbackLookahead = 12,
    idleLookahead = 4,
  } = options;

  const pending = new Set<number>();

  const fetchAndSplice = async (frameIndex: number) => {
    const currentFile = useStore.getState().file;
    const totalFrames = currentFile?.trajectory.totalFrames ?? 0;
    if (!currentFile || frameIndex < 0 || frameIndex >= totalFrames) return;
    if (!matchesActiveFile(sourceUrl, name)) return;
    if (currentFile.trajectory.frames[frameIndex]) return;
    if (pending.has(frameIndex)) return;

    pending.add(frameIndex);
    try {
      const frame = await source.fetchFrame(frameIndex);
      const file = useStore.getState().file;
      if (!file || !matchesActiveFile(sourceUrl, name)) return;
      if (!file.trajectory.frames[frameIndex]) {
        file.trajectory.frames[frameIndex] = frame;
        useStore.setState({ file: { ...file } });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[${label}] frame ${frameIndex} fetch failed:`, message);
    } finally {
      pending.delete(frameIndex);
    }
  };

  const request: RequestStreamingFrame = (frameIndex, direction = 1, lookahead = 0) => {
    const file = useStore.getState().file;
    const totalFrames = file?.trajectory.totalFrames ?? 0;
    if (!file || totalFrames <= 0 || !matchesActiveFile(sourceUrl, name)) return;

    const step = direction < 0 ? -1 : 1;
    const safeLookahead = clampLookaheadForActiveFile(lookahead);
    void fetchAndSplice(frameIndex);
    for (let i = 1; i <= safeLookahead; i += 1) {
      const next = frameIndex + step * i;
      if (next < 0 || next >= totalFrames) break;
      void fetchAndSplice(next);
    }
  };

  let previousFrame = useStore.getState().frame;
  const unsubFrameWatch = useStore.subscribe(
    (s) => s.frame,
    (frameIndex) => {
      const playing = useStore.getState().playing;
      const direction = frameIndex >= previousFrame ? 1 : -1;
      previousFrame = frameIndex;
      request(frameIndex, direction, playing ? playbackLookahead : idleLookahead);
    },
  );

  const unsubPlayingWatch = useStore.subscribe(
    (s) => s.playing,
    (playing) => {
      if (!playing) return;
      const frameIndex = useStore.getState().frame;
      request(frameIndex, 1, playbackLookahead);
    },
  );

  const w = getWindow();
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubFrameWatch();
    unsubPlayingWatch();
    pending.clear();
    source.dispose?.();
    if (w?.__atlasRequestStreamingFrame === request) {
      delete w.__atlasRequestStreamingFrame;
    }
    if (w?.__atlasStreamingCleanup === cleanup) {
      delete w.__atlasStreamingCleanup;
    }
  };

  if (w) {
    w.__atlasRequestStreamingFrame = request;
    w.__atlasStreamingCleanup = cleanup;
  }

  request(useStore.getState().frame, 1, initialLookahead);
  return cleanup;
}
