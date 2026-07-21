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
  /** Aggregate typed-array payload retained by the UI/source handoff. */
  maxResidentBytes?: number;
};

// Keep common short research trajectories (including the 61-frame R32 run)
// resident after one pass. The byte budget remains authoritative for larger
// atom counts, so raising the count ceiling does not make memory unbounded.
export const DEFAULT_STREAMING_RESIDENT_FRAMES = 64;
export const DEFAULT_STREAMING_RESIDENT_BYTES = 64 * 1024 * 1024;
const MAX_SAME_GENERATION_RETRIES = 2;
const FRAME_RETRY_BASE_DELAY_MS = 250;

/**
 * Counts retained ArrayBuffer payload once even when multiple typed-array
 * views share it. Object/string overhead is intentionally outside this
 * scientific-payload budget, so this is a conservative lower-bound receipt,
 * not a browser-heap claim.
 */
export function estimateFrameResidentBytes(frame: Frame): number {
  const buffers = new Set<ArrayBufferLike>();
  const retain = (view: ArrayBufferView | undefined) => {
    if (view) buffers.add(view.buffer);
  };
  retain(frame.boxBounds);
  retain(frame.boxTilt);
  retain(frame.ids);
  retain(frame.types);
  retain(frame.positions);
  retain(frame.bonds);
  for (const values of frame.properties.values()) retain(values);
  let total = 0;
  for (const buffer of buffers) total += buffer.byteLength;
  return total;
}

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
    maxResidentFrames = DEFAULT_STREAMING_RESIDENT_FRAMES,
    maxResidentBytes = DEFAULT_STREAMING_RESIDENT_BYTES,
  } = options;
  if (!Number.isSafeInteger(maxResidentFrames) || maxResidentFrames < 2) {
    throw new Error(`Invalid streaming resident-frame budget: ${maxResidentFrames}`);
  }
  if (!Number.isSafeInteger(maxResidentBytes) || maxResidentBytes < 1) {
    throw new Error(`Invalid streaming resident-byte budget: ${maxResidentBytes}`);
  }

  const pending = new Map<number, number>();
  const retryAttempts = new Map<number, { generation: number; count: number }>();
  const retryTimers = new Map<number, {
    generation: number;
    id: ReturnType<typeof setTimeout>;
  }>();
  const residentOrder: number[] = [];
  let desiredResident = new Set<number>([0]);
  let pinnedResident = new Set<number>([useStore.getState().frame]);
  let windowController = new AbortController();
  let windowGeneration = 0;
  let windowTarget = useStore.getState().frame;
  let windowDirection = 1;
  let disposed = false;

  const clearFrameRetry = (frameIndex: number) => {
    const scheduled = retryTimers.get(frameIndex);
    if (scheduled) clearTimeout(scheduled.id);
    retryTimers.delete(frameIndex);
    retryAttempts.delete(frameIndex);
  };

  const clearAllFrameRetries = () => {
    for (const scheduled of retryTimers.values()) clearTimeout(scheduled.id);
    retryTimers.clear();
    retryAttempts.clear();
  };

  const touchResident = (frameIndex: number) => {
    const existing = residentOrder.indexOf(frameIndex);
    if (existing >= 0) residentOrder.splice(existing, 1);
    residentOrder.push(frameIndex);
  };

  const evictToBudget = (
    file: LoadedFile,
    targetResidentFrames = maxResidentFrames,
    targetResidentBytes = maxResidentBytes,
  ) => {
    const frames = file.trajectory.frames;
    let residentCount = frames.reduce((count, candidate) => count + (candidate ? 1 : 0), 0);
    let residentBytes = frames.reduce(
      (total, candidate) => total + (candidate ? estimateFrameResidentBytes(candidate) : 0),
      0,
    );
    let changed = false;
    while (residentCount > targetResidentFrames || residentBytes > targetResidentBytes) {
      let candidateAt = residentOrder.findIndex(
        (index) => frames[index] && !desiredResident.has(index) && !pinnedResident.has(index),
      );
      // If the desired window itself exceeds the measured byte budget, retain
      // the addressed playhead and shed speculative lookahead/legacy frame 0.
      if (candidateAt < 0) {
        candidateAt = residentOrder.findIndex(
          (index) => frames[index] && !pinnedResident.has(index),
        );
      }
      if (candidateAt < 0) break;
      const [candidate] = residentOrder.splice(candidateAt, 1);
      residentBytes -= estimateFrameResidentBytes(frames[candidate]!);
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
    initialFile.trajectory.residency = { mode: 'sparse', maxResidentFrames, maxResidentBytes };
    evictToBudget(initialFile);
    useStore.setState({ file: { ...initialFile } });
  }

  const fetchAndSplice = async (
    frameIndex: number,
    generation: number,
    signal: AbortSignal,
  ) => {
    if (disposed || signal.aborted) return;
    const scheduledRetry = retryTimers.get(frameIndex);
    if (scheduledRetry?.generation === generation) return;
    if (scheduledRetry) clearFrameRetry(frameIndex);
    const currentFile = useStore.getState().file;
    const totalFrames = currentFile?.trajectory.totalFrames ?? 0;
    if (!currentFile || frameIndex < 0 || frameIndex >= totalFrames) return;
    if (!matchesActiveFile(sourceUrl, name)) return;
    if (currentFile.trajectory.frames[frameIndex]) {
      clearFrameRetry(frameIndex);
      touchResident(frameIndex);
      return;
    }
    if (pending.has(frameIndex)) return;

    let retryableFailure = false;
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
        clearFrameRetry(frameIndex);
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
        retryableFailure = true;
        console.warn(`[${label}] frame ${frameIndex} fetch failed:`, normalized.message);
      }
    } finally {
      if (pending.get(frameIndex) === generation) pending.delete(frameIndex);
      if (
        retryableFailure &&
        !disposed &&
        !signal.aborted &&
        generation === windowGeneration &&
        desiredResident.has(frameIndex) &&
        !useStore.getState().file?.trajectory.frames[frameIndex] &&
        !pending.has(frameIndex) &&
        !retryTimers.has(frameIndex)
      ) {
        const previous = retryAttempts.get(frameIndex);
        const previousCount = previous?.generation === generation ? previous.count : 0;
        if (previousCount < MAX_SAME_GENERATION_RETRIES) {
          const nextCount = previousCount + 1;
          retryAttempts.set(frameIndex, { generation, count: nextCount });
          const delay = FRAME_RETRY_BASE_DELAY_MS * (2 ** (nextCount - 1));
          const id = setTimeout(() => {
            const scheduled = retryTimers.get(frameIndex);
            if (!scheduled || scheduled.generation !== generation) return;
            retryTimers.delete(frameIndex);
            const file = useStore.getState().file;
            if (file?.trajectory.frames[frameIndex]) {
              retryAttempts.delete(frameIndex);
              return;
            }
            if (
              !disposed &&
              !signal.aborted &&
              generation === windowGeneration &&
              desiredResident.has(frameIndex)
            ) {
              void fetchAndSplice(frameIndex, generation, signal);
            }
          }, delay);
          retryTimers.set(frameIndex, { generation, id });
        }
      }
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
    const referenceFrame = file.trajectory.frames[frameIndex]
      ?? file.trajectory.frames.find(Boolean);
    const referenceBytes = referenceFrame ? estimateFrameResidentBytes(referenceFrame) : 0;
    const byteLimitedFrames = referenceBytes > 0
      ? Math.max(1, Math.floor(maxResidentBytes / referenceBytes))
      : maxResidentFrames;
    const effectiveResidentFrames = Math.min(maxResidentFrames, byteLimitedFrames);
    const baseWindowFrames = frameIndex === 0 ? 1 : 2;
    const safeLookahead = Math.min(
      clampLookaheadForActiveFile(lookahead),
      Math.max(0, effectiveResidentFrames - baseWindowFrames),
    );
    const nextDesiredResident = new Set([0, frameIndex]);
    for (let i = 1; i <= safeLookahead; i += 1) {
      const next = frameIndex + step * i;
      if (next < 0 || next >= totalFrames) break;
      nextDesiredResident.add(next);
    }
    // Playback advances one source frame at a time, so adjacent windows share
    // almost every requested frame. Reuse the live AbortController for that
    // overlap. Aborting the whole batch on every source-frame or animation
    // request creates a range-fetch livelock where no missing frame can finish.
    const reuseCurrentWindow = windowGeneration > 0
      && step === windowDirection
      && desiredResident.has(frameIndex)
      && Math.abs(frameIndex - windowTarget) <= Math.max(2, safeLookahead);

    desiredResident = nextDesiredResident;
    pinnedResident = new Set([frameIndex]);
    windowTarget = frameIndex;
    windowDirection = step;

    if (reuseCurrentWindow) {
      for (const retryFrame of Array.from(retryAttempts.keys())) {
        if (!nextDesiredResident.has(retryFrame)) clearFrameRetry(retryFrame);
      }
    }

    const missingDesiredFrames = Array.from(nextDesiredResident).reduce(
      (count, index) => count + (file.trajectory.frames[index] ? 0 : 1),
      0,
    );
    const reservedBytes = referenceBytes * missingDesiredFrames;
    // Reserve slots before starting fetches. A source may cache a completed
    // frame before this coordinator receives it; reserving prevents that
    // handoff from temporarily exceeding the aggregate scientific-frame cap.
    if (evictToBudget(
      file,
      Math.max(0, maxResidentFrames - missingDesiredFrames),
      Math.max(0, maxResidentBytes - reservedBytes),
    )) {
      useStore.setState({ file: { ...file } });
    }
    if (!reuseCurrentWindow) {
      clearAllFrameRetries();
      windowController.abort();
      windowController = new AbortController();
      windowGeneration += 1;
    }
    const generation = windowGeneration;
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
    clearAllFrameRetries();
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
