/**
 * clipEncoder.ts — the offline clip's encoder: WebCodecs' VideoEncoder into
 * an MP4 (mp4-muxer).
 *
 * The codec is the first of this ladder the browser says it can encode at the
 * clip's size (`VideoEncoder.isConfigSupported`):
 *
 *   H.264 High            avc1.64001F (720×1280) · avc1.640028 (1080×1920)
 *   H.264 Constr. Baseline avc1.42E01F           · avc1.42E028
 *   VP9 profile 0, 8-bit  vp09.00.31.08          · vp09.00.40.08
 *   AV1 Main, 8-bit       av01.0.05M.08          · av01.0.08M.08
 *
 * The level is the lowest that holds the frame at 30 fps (H.264 3.1 holds
 * 1280×720, 4.0 holds 1080×1920). H.264 plays everywhere a clip is posted,
 * so it comes first; VP9 and AV1 in MP4 play in current browsers and most
 * apps. With none of them (or no WebCodecs at all) Instant Replay records
 * the clip with MediaRecorder instead, as it always did (ReplaySheet).
 *
 * Every frame carries its timestamp on the clip's clock (clipSchedule.ts),
 * so the file has exactly one frame per 1/30 s, however long each took to
 * draw. A keyframe every 2 s keeps scrubbing cheap.
 */
import { ArrayBufferTarget, Muxer, type MuxerOptions } from 'mp4-muxer';
import { CLIP_FPS, clipFrameDuration, clipFrameTimestamp } from './clipSchedule';

/** The clip's bitrate (bits per second), as the recorded clip used. */
export const CLIP_BITRATE = 8_000_000;
/** A keyframe every this many frames (2 s). */
export const CLIP_KEYFRAME_EVERY = 60;
/** Frames waiting in the encoder before the renderer waits for it. */
const MAX_ENCODE_QUEUE = 4;
/** H.264 level 3.1's largest frame, in 16×16 macroblocks (1280×720). */
const LEVEL_31_MACROBLOCKS = 3600;

/** The codec names mp4-muxer takes. */
export type ClipMuxerCodec = 'avc' | 'vp9' | 'av1';

export interface ClipCodecCandidate {
  /** The WebCodecs codec string. */
  codec: string;
  muxer: ClipMuxerCodec;
  /** What the sheet calls it. */
  name: 'H.264' | 'VP9' | 'AV1';
}

export interface ClipCodecChoice extends ClipCodecCandidate {
  config: VideoEncoderConfig;
}

/** The codecs to try for a w×h clip, best first. */
export function clipCodecLadder(width: number, height: number): ClipCodecCandidate[] {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  const large = macroblocks > LEVEL_31_MACROBLOCKS;
  const avc = large ? '28' : '1F';
  const vp9 = large ? '40' : '31';
  const av1 = large ? '08' : '05';
  return [
    { codec: `avc1.6400${avc}`, muxer: 'avc', name: 'H.264' },
    { codec: `avc1.42E0${avc}`, muxer: 'avc', name: 'H.264' },
    { codec: `vp09.00.${vp9}.08`, muxer: 'vp9', name: 'VP9' },
    { codec: `av01.0.${av1}M.08`, muxer: 'av1', name: 'AV1' },
  ];
}

/** The VideoEncoder configuration for a candidate at w×h. */
export function clipEncoderConfig(candidate: ClipCodecCandidate, width: number, height: number): VideoEncoderConfig {
  const config: VideoEncoderConfig = {
    codec: candidate.codec,
    width,
    height,
    bitrate: CLIP_BITRATE,
    framerate: CLIP_FPS,
    latencyMode: 'quality',
    hardwareAcceleration: 'no-preference',
  };
  // MP4 wants the parameter sets in the sample description (avcC), not in-band.
  if (candidate.muxer === 'avc') config.avc = { format: 'avc' };
  return config;
}

/** True when this browser has the WebCodecs pieces the offline clip uses. */
export function hasClipEncoder(): boolean {
  return typeof VideoEncoder !== 'undefined'
    && typeof VideoFrame !== 'undefined'
    && typeof VideoEncoder.isConfigSupported === 'function';
}

export type ClipConfigProbe = (config: VideoEncoderConfig) => Promise<boolean>;

const probeBrowser: ClipConfigProbe = async (config) => {
  const support = await VideoEncoder.isConfigSupported(config);
  return support.supported === true;
};

/**
 * The first codec of the ladder the browser can encode at w×h, or null (no
 * WebCodecs, or none of them): the clip is then recorded with MediaRecorder.
 */
export async function chooseClipCodec(
  width: number,
  height: number,
  probe: ClipConfigProbe | null = hasClipEncoder() ? probeBrowser : null,
): Promise<ClipCodecChoice | null> {
  if (!probe) return null;
  for (const candidate of clipCodecLadder(width, height)) {
    const config = clipEncoderConfig(candidate, width, height);
    try {
      if (await probe(config)) return { ...candidate, config };
    } catch {
      // A probe that throws is a no.
    }
  }
  return null;
}

/** The muxer's options for a clip (the target is the caller's). */
export function clipMuxerOptions(choice: ClipCodecCandidate, width: number, height: number): Omit<MuxerOptions<ArrayBufferTarget>, 'target'> {
  return {
    video: { codec: choice.muxer, width, height, frameRate: CLIP_FPS },
    // The index up front: a shared clip starts playing before it has fully loaded.
    fastStart: 'in-memory',
    firstTimestampBehavior: 'strict',
  };
}

/** sRGB-ish BT.709, limited range: what a canvas frame encodes to when the encoder says nothing. */
const DEFAULT_COLOR_SPACE: VideoColorSpaceInit = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

/**
 * A chunk's metadata as the muxer needs it: mp4-muxer requires a colour space
 * in a VP9 decoder config (its vpcC box), which some encoders leave out.
 */
export function clipChunkMeta(muxer: ClipMuxerCodec, meta: EncodedVideoChunkMetadata | undefined): EncodedVideoChunkMetadata | undefined {
  const decoderConfig = meta?.decoderConfig;
  if (muxer !== 'vp9' || !decoderConfig || decoderConfig.colorSpace) return meta;
  return { ...meta, decoderConfig: { ...decoderConfig, colorSpace: DEFAULT_COLOR_SPACE } };
}

export interface ClipEncoder {
  readonly choice: ClipCodecChoice;
  /** Encode frame `index` from the canvas (its pixels are copied at once). */
  encode(source: HTMLCanvasElement | OffscreenCanvas, index: number): Promise<void>;
  /** Flush, finalize, and return the MP4. */
  finish(): Promise<Blob>;
  /** Abandon the clip (safe after finish). */
  close(): void;
}

/** A VideoEncoder and an MP4 muxer for one clip. */
export function createClipEncoder(choice: ClipCodecChoice, width: number, height: number): ClipEncoder {
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, ...clipMuxerOptions(choice, width, height) });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, clipChunkMeta(choice.muxer, meta));
      } catch (error) {
        failure ??= error;
      }
    },
    error: (error) => {
      failure ??= error;
    },
  });
  encoder.configure(choice.config);

  // The encoder took a frame (or 20 ms passed: not every browser fires `dequeue`).
  const drained = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        encoder.removeEventListener('dequeue', done);
        resolve();
      };
      encoder.addEventListener('dequeue', done);
      setTimeout(done, 20);
    });

  const close = () => {
    if (encoder.state !== 'closed') encoder.close();
  };

  return {
    choice,
    async encode(source, index) {
      if (failure) throw failure;
      const frame = new VideoFrame(source, { timestamp: clipFrameTimestamp(index), duration: clipFrameDuration(index) });
      try {
        encoder.encode(frame, { keyFrame: index % CLIP_KEYFRAME_EVERY === 0 });
      } finally {
        frame.close();
      }
      while (encoder.encodeQueueSize > MAX_ENCODE_QUEUE && !failure) await drained();
      if (failure) throw failure;
    },
    async finish() {
      if (failure) throw failure;
      await encoder.flush();
      if (failure) throw failure;
      muxer.finalize();
      close();
      return new Blob([target.buffer], { type: 'video/mp4' });
    },
    close,
  };
}
