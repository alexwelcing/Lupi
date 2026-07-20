import type { Frame } from '@atlas/core/types';
import { useStore, type LoadedFile } from './store';

type StreamingFrameSource = {
  fetchFrame: (frameIndex: number, signal?: AbortSignal) => Promise<Frame>;
  releaseFrame?: (frameIndex: number) => void;
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
  maxResidentFrames?: number;
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
    maxResidentFrames = 20,
  } = options;
  if (!Number.isSafeInteger(maxResidentFrames) || maxResidentFrames < 2) {
    throw new Error(`Invalid streaming resident-frame budget: ${maxResidentFrames}`);
  }

  const pending = new Map<number, number>();
  const residentOrder: number[] = [];
  let desiredResident = new Set<number>([0]);
  let windowController = new AbortController();
  let windowGeneration = 0;
  let disposed = false;

  const touchResident = (frameIndex: number) => {
    const existing = residentOrder.indexOf(frameIndex);
    if (existing >= 0) residentOrder.splice(existing, 1);
    residentOrder.push(frameIndex);
  };

  const evictToBudget = (file: LoadedFile, targetResidentFrames = maxResidentFrames) => {
    const frames = file.trajectory.frames;
    let residentCount = frames.reduce((count, candidate) => count + (candidate ? 1 : 0), 0);
    let changed = false;
    while (residentCount > targetResidentFrames) {
      const candidateAt = residentOrder.findIndex(
        (index) => frames[index] && !desiredResident.has(index),
      );
      if (candidateAt < 0) break;
      const [candidate] = residentOrder.splice(candidateAt, 1);
      frames[candidate] = undefined;
      source.releaseFrame?.(candidate);
      residentCount -= 1;
      changed = true;
    }
    return changed;
  };

  const initialFile = useStore.getState().file;
  if (initialFile) {
    initialFile.trajectory.frames.forEach((frame, index) => {
      if (frame) residentOrder.push(index);
    });
    initialFile.trajectory.residency = { mode: 'sparse', maxResidentFrames };
    evictToBudget(initialFile);
    useStore.setState({ file: { ...initialFile } });
  }

  const fetchAndSplice = async (
    frameIndex: number,
    generation: number,
    signal: AbortSignal,
  ) => {
    if (disposed || signal.aborted) return;
    const currentFile = useStore.getState().file;
    const totalFrames = currentFile?.trajectory.totalFrames ?? 0;
    if (!currentFile || frameIndex < 0 || frameIndex >= totalFrames) return;
    if (!matchesActiveFile(sourceUrl, name)) return;
    if (currentFile.trajectory.frames[frameIndex]) {
      touchResident(frameIndex);
      return;
    }
    if (pending.has(frameIndex)) return;

    pending.set(frameIndex, generation);
    try {
      const frame = await source.fetchFrame(frameIndex, signal);
      if (disposed || signal.aborted || generation !== windowGeneration) {
        source.releaseFrame?.(frameIndex);
        return;
      }
      const file = useStore.getState().file;
      if (!file || !matchesActiveFile(sourceUrl, name)) {
        source.releaseFrame?.(frameIndex);
        return;
      }
      if (!file.trajectory.frames[frameIndex]) {
        file.trajectory.frames[frameIndex] = frame;
        touchResident(frameIndex);
        evictToBudget(file);
        useStore.setState({ file: { ...file } });
      } else if (file.trajectory.frames[frameIndex] !== frame) {
        source.releaseFrame?.(frameIndex);
      }
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      if (normalized.name !== 'AbortError' && !signal.aborted) {
        console.warn(`[${label}] frame ${frameIndex} fetch failed:`, normalized.message);
      }
    } finally {
      if (pending.get(frameIndex) === generation) pending.delete(frameIndex);
      if (
        !disposed &&
        generation !== windowGeneration &&
        desiredResident.has(frameIndex) &&
        !useStore.getState().file?.trajectory.frames[frameIndex] &&
        !pending.has(frameIndex)
      ) {
        void fetchAndSplice(frameIndex, windowGeneration, windowController.signal);
      }
    }
  };

  const request: RequestStreamingFrame = (frameIndex, direction = 1, lookahead = 0) => {
    const file = useStore.getState().file;
    const totalFrames = file?.trajectory.totalFrames ?? 0;
    if (!file || totalFrames <= 0 || !matchesActiveFile(sourceUrl, name)) return;

    const step = direction < 0 ? -1 : 1;
    const safeLookahead = Math.min(
      clampLookaheadForActiveFile(lookahead),
      Math.max(0, maxResidentFrames - 2),
    );
    desiredResident = new Set([0, frameIndex]);
    for (let i = 1; i <= safeLookahead; i += 1) {
      const next = frameIndex + step * i;
      if (next < 0 || next >= totalFrames) break;
      desiredResident.add(next);
    }
    const missingDesiredFrames = Array.from(desiredResident).reduce(
      (count, index) => count + (file.trajectory.frames[index] ? 0 : 1),
      0,
    );
    // Reserve slots before starting fetches. A source may cache a completed
    // frame before this coordinator receives it; reserving prevents that
    // handoff from temporarily exceeding the aggregate scientific-frame cap.
    if (evictToBudget(file, Math.max(0, maxResidentFrames - missingDesiredFrames))) {
      useStore.setState({ file: { ...file } });
    }
    windowController.abort();
    windowController = new AbortController();
    const generation = ++windowGeneration;
    const signal = windowController.signal;
    void fetchAndSplice(frameIndex, generation, signal);
    for (let i = 1; i <= safeLookahead; i += 1) {
      const next = frameIndex + step * i;
      if (next < 0 || next >= totalFrames) break;
      void fetchAndSplice(next, generation, signal);
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
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    unsubFrameWatch();
    unsubPlayingWatch();
    windowController.abort();
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
