import { describe, expect, it } from 'vitest';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  CLIP_BITRATE,
  chooseClipCodec,
  clipChunkMeta,
  clipCodecLadder,
  clipEncoderConfig,
  clipMuxerOptions,
  type ClipCodecCandidate,
} from './clipEncoder';
import { clipFrameCount, clipFrameDuration, clipFrameTimestamp } from './clipSchedule';

describe('the clip codec ladder', () => {
  it('tries H.264 High, then Constrained Baseline, then VP9, then AV1, at the lowest level that holds the frame', () => {
    expect(clipCodecLadder(720, 1280).map((entry) => entry.codec)).toEqual([
      'avc1.64001F',
      'avc1.42E01F',
      'vp09.00.31.08',
      'av01.0.05M.08',
    ]);
    expect(clipCodecLadder(1080, 1920).map((entry) => entry.codec)).toEqual([
      'avc1.640028',
      'avc1.42E028',
      'vp09.00.40.08',
      'av01.0.08M.08',
    ]);
    expect(clipCodecLadder(1080, 1920).map((entry) => entry.muxer)).toEqual(['avc', 'avc', 'vp9', 'av1']);
  });

  it('picks the first codec the browser can encode', async () => {
    const asked: string[] = [];
    const vp9Only = async (config: VideoEncoderConfig) => {
      asked.push(config.codec);
      return config.codec.startsWith('vp09');
    };
    const choice = await chooseClipCodec(1080, 1920, vp9Only);
    expect(choice?.codec).toBe('vp09.00.40.08');
    expect(choice?.name).toBe('VP9');
    expect(asked).toEqual(['avc1.640028', 'avc1.42E028', 'vp09.00.40.08']);
    expect(choice?.config).toMatchObject({ codec: 'vp09.00.40.08', width: 1080, height: 1920 });
  });

  it('treats a probe that throws as a no, and has no codec without WebCodecs', async () => {
    const baselineOnly = async (config: VideoEncoderConfig) => {
      if (config.codec === 'avc1.64001F') throw new Error('unsupported profile');
      return config.codec === 'avc1.42E01F';
    };
    expect((await chooseClipCodec(720, 1280, baselineOnly))?.codec).toBe('avc1.42E01F');
    expect(await chooseClipCodec(720, 1280, async () => false)).toBeNull();
    expect(await chooseClipCodec(720, 1280, null)).toBeNull();
    // jsdom has no VideoEncoder: the default probe is absent.
    expect(await chooseClipCodec(720, 1280)).toBeNull();
  });

  it('configures the encoder for the clip: 30 fps, 8 Mbps, H.264 parameter sets out of band for MP4', () => {
    const [high, , vp9] = clipCodecLadder(1080, 1920);
    expect(clipEncoderConfig(high, 1080, 1920)).toEqual({
      codec: 'avc1.640028',
      width: 1080,
      height: 1920,
      bitrate: CLIP_BITRATE,
      framerate: 30,
      latencyMode: 'quality',
      hardwareAcceleration: 'no-preference',
      avc: { format: 'avc' },
    });
    expect(clipEncoderConfig(vp9, 1080, 1920).avc).toBeUndefined();
  });
});

describe('the clip muxer', () => {
  it('writes MP4 with the index up front and timestamps on the 30 fps grid', () => {
    const [high] = clipCodecLadder(720, 1280);
    expect(clipMuxerOptions(high, 720, 1280)).toEqual({
      video: { codec: 'avc', width: 720, height: 1280, frameRate: 30 },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'strict',
    });
  });

  it('gives a VP9 decoder config the colour space the muxer needs, and leaves the rest alone', () => {
    const bare = { decoderConfig: { codec: 'vp09.00.40.08', codedWidth: 1080, codedHeight: 1920 } };
    expect(clipChunkMeta('vp9', bare)?.decoderConfig?.colorSpace).toEqual({
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: false,
    });
    const own = { decoderConfig: { ...bare.decoderConfig, colorSpace: { primaries: 'smpte170m' as const, fullRange: true } } };
    expect(clipChunkMeta('vp9', own)).toBe(own);
    expect(clipChunkMeta('avc', bare)).toBe(bare);
    expect(clipChunkMeta('vp9', undefined)).toBeUndefined();
  });

  it('muxes a clip into ftyp, moov and mdat with one sample per frame', () => {
    const frames = clipFrameCount(1.5);
    for (const candidate of [clipCodecLadder(720, 1280)[0], clipCodecLadder(720, 1280)[2]] as ClipCodecCandidate[]) {
      const target = new ArrayBufferTarget();
      const muxer = new Muxer({ target, ...clipMuxerOptions(candidate, 720, 1280) });
      const decoderConfig: VideoDecoderConfig = candidate.muxer === 'avc'
        // A minimal AVCDecoderConfigurationRecord (version, profile, compat, level, lengths, no SPS/PPS).
        ? { codec: candidate.codec, codedWidth: 720, codedHeight: 1280, description: new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe0, 0]) }
        : { codec: candidate.codec, codedWidth: 720, codedHeight: 1280 };
      for (let i = 0; i < frames; i += 1) {
        const meta = i === 0 ? clipChunkMeta(candidate.muxer, { decoderConfig }) : undefined;
        muxer.addVideoChunkRaw(new Uint8Array([i & 0xff, 1, 2, 3]), i % 60 === 0 ? 'key' : 'delta', clipFrameTimestamp(i), clipFrameDuration(i), meta);
      }
      muxer.finalize();
      const bytes = new Uint8Array(target.buffer);
      expect(topLevelBoxes(bytes)).toEqual(['ftyp', 'moov', 'mdat']);
      expect(sampleCount(bytes)).toBe(frames);
      expect(sampleEntry(bytes)).toBe(candidate.muxer === 'avc' ? 'avc1' : 'vp09');
    }
  });
});

function boxes(bytes: Uint8Array, start: number, end: number): Array<{ type: string; start: number; end: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const found: Array<{ type: string; start: number; end: number }> = [];
  let at = start;
  while (at + 8 <= end) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    if (size < 8) break;
    found.push({ type, start: at, end: at + size });
    at += size;
  }
  return found;
}

function topLevelBoxes(bytes: Uint8Array): string[] {
  return boxes(bytes, 0, bytes.length).map((box) => box.type);
}

/** The box at `path` (each level's header is 8 bytes; `stsd` and `stsz` are full boxes). */
function find(bytes: Uint8Array, path: string[]): { start: number; end: number } | null {
  let range = { start: 0, end: bytes.length };
  for (const type of path) {
    const next = boxes(bytes, range.start, range.end).find((box) => box.type === type);
    if (!next) return null;
    range = { start: next.start + 8, end: next.end };
  }
  return range;
}

const STBL = ['moov', 'trak', 'mdia', 'minf', 'stbl'];

function sampleCount(bytes: Uint8Array): number {
  const stsz = find(bytes, [...STBL, 'stsz']);
  if (!stsz) return -1;
  // version/flags, sample_size, sample_count
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(stsz.start + 8);
}

function sampleEntry(bytes: Uint8Array): string {
  const stsd = find(bytes, [...STBL, 'stsd']);
  if (!stsd) return '';
  // version/flags, entry_count, then the first entry's size and type
  return String.fromCharCode(...bytes.subarray(stsd.start + 12, stsd.start + 16));
}
