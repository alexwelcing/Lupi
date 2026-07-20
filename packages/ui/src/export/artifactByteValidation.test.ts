import { describe, expect, it, vi } from 'vitest';
import {
  type ArtifactAlphaModeV1,
  type ArtifactByteFormatV1,
  type DecodedRasterV1,
  validateArtifactBytesV1,
} from './artifactByteValidation';

const encoder = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function u16be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function u32be(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function pngChunk(type: string, data = new Uint8Array()): Uint8Array {
  // The runtime decoder validates the compressed payload; the structural seam
  // intentionally does not duplicate PNG CRC work.
  return concat(u32be(data.byteLength), encoder.encode(type), data, new Uint8Array(4));
}

function png(width: number, height: number): Uint8Array {
  const header = concat(
    u32be(width),
    u32be(height),
    new Uint8Array([8, 6, 0, 0, 0]),
  );
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array([0])),
    pngChunk('IEND'),
  );
}

function jpeg(width: number, height: number): Uint8Array {
  return concat(
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0]),
    u16be(17),
    new Uint8Array([8]),
    u16be(height),
    u16be(width),
    new Uint8Array([3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]),
    new Uint8Array([0xff, 0xd9]),
  );
}

function setUint24(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
}

function webp(width: number, height: number): Uint8Array {
  const vp8x = new Uint8Array(10);
  setUint24(vp8x, 4, width - 1);
  setUint24(vp8x, 7, height - 1);
  const vp8 = new Uint8Array(10);
  vp8.set([0x9d, 0x01, 0x2a], 3);
  vp8[6] = width & 0xff;
  vp8[7] = (width >>> 8) & 0x3f;
  vp8[8] = height & 0xff;
  vp8[9] = (height >>> 8) & 0x3f;
  const chunks = concat(
    encoder.encode('VP8X'), new Uint8Array([10, 0, 0, 0]), vp8x,
    encoder.encode('VP8 '), new Uint8Array([10, 0, 0, 0]), vp8,
  );
  const bytes = new Uint8Array(12 + chunks.byteLength);
  bytes.set(encoder.encode('RIFF'), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.byteLength - 8, true);
  bytes.set(encoder.encode('WEBP'), 8);
  bytes.set(chunks, 12);
  return bytes;
}

function decoded(width: number, height: number, alphas: number[]): DecodedRasterV1 {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    pixels[pixel * 4] = 10;
    pixels[pixel * 4 + 1] = 20;
    pixels[pixel * 4 + 2] = 30;
    pixels[pixel * 4 + 3] = alphas[pixel % alphas.length];
  }
  return { width, height, pixels };
}

function rasterBytes(format: ArtifactByteFormatV1, width: number, height: number): Uint8Array {
  if (format === 'png') return png(width, height);
  if (format === 'jpeg') return jpeg(width, height);
  if (format === 'webp') return webp(width, height);
  throw new Error(`No raster fixture for ${format}`);
}

function rasterMime(format: ArtifactByteFormatV1): string {
  if (format === 'png') return 'image/png';
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'webp') return 'image/webp';
  throw new Error(`No raster MIME for ${format}`);
}

function glb(json: Record<string, unknown> = { asset: { version: '2.0' }, scenes: [{}], scene: 0 }): Uint8Array {
  const rawJson = encoder.encode(JSON.stringify(json));
  const paddedLength = Math.ceil(rawJson.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + paddedLength);
  bytes.set(encoder.encode('glTF'), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, paddedLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20);
  bytes.set(rawJson, 20);
  return bytes;
}

let crcTable: Uint32Array | undefined;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let value = 0; value < 256; value += 1) {
      let crc = value;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
      crcTable[value] = crc >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipInput {
  name: string;
  data: string;
}

function storedAlignedZip(inputs: ZipInput[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const records: Array<{ input: ZipInput; name: Uint8Array; data: Uint8Array; crc: number; offset: number }> = [];
  let offset = 0;
  for (const input of inputs) {
    const name = encoder.encode(input.name);
    const data = encoder.encode(input.data);
    let extraLength = (64 - ((offset + 30 + name.byteLength) & 63)) & 63;
    if (extraLength > 0 && extraLength < 4) extraLength += 64;
    const extra = new Uint8Array(extraLength);
    if (extraLength >= 4) {
      const extraView = new DataView(extra.buffer);
      extraView.setUint16(0, 0x3039, true);
      extraView.setUint16(2, extraLength - 4, true);
    }
    const checksum = crc32(data);
    const header = new Uint8Array(30);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, checksum, true);
    view.setUint32(18, data.byteLength, true);
    view.setUint32(22, data.byteLength, true);
    view.setUint16(26, name.byteLength, true);
    view.setUint16(28, extra.byteLength, true);
    records.push({ input, name, data, crc: checksum, offset });
    const local = concat(header, name, extra, data);
    localParts.push(local);
    offset += local.byteLength;
  }

  const centralOffset = offset;
  const centralParts = records.map((record) => {
    const header = new Uint8Array(46);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint32(16, record.crc, true);
    view.setUint32(20, record.data.byteLength, true);
    view.setUint32(24, record.data.byteLength, true);
    view.setUint16(28, record.name.byteLength, true);
    view.setUint32(42, record.offset, true);
    return concat(header, record.name);
  });
  const central = concat(...centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, records.length, true);
  endView.setUint16(10, records.length, true);
  endView.setUint32(12, central.byteLength, true);
  endView.setUint32(16, centralOffset, true);
  return concat(...localParts, central, end);
}

function usdz(overrides: Partial<{ geometryName: string; reference: string }> = {}): Uint8Array {
  const geometryName = overrides.geometryName ?? 'geometries/Geometry_0.usda';
  const reference = overrides.reference ?? geometryName;
  return storedAlignedZip([
    {
      name: 'model.usda',
      data: `#usda 1.0\n(\n defaultPrim = "Root"\n)\ndef Xform "Root" (prepend references = @./${reference}@) {}\n`,
    },
    { name: geometryName, data: '#usda 1.0\ndef Mesh "Geometry" {}\n' },
  ]);
}

describe('raster artifact byte conformance', () => {
  it.each([
    ['png', 'opaque'],
    ['jpeg', 'opaque'],
    ['webp', 'opaque'],
  ] as Array<[ArtifactByteFormatV1, ArtifactAlphaModeV1]>)
  ('sniffs a valid %s with an empty Blob.type and verifies decoded dimensions/alpha', async (format, alpha) => {
    const decodeRaster = vi.fn(async () => decoded(3, 2, [255]));
    const result = await validateArtifactBytesV1(
      new Blob([rasterBytes(format, 3, 2)]),
      { format, width: 3, height: 2, alpha },
      { decodeRaster },
    );
    expect(result).toMatchObject({ mimeType: rasterMime(format), width: 3, height: 2 });
    expect(result.bytes).toEqual(rasterBytes(format, 3, 2));
    expect(decodeRaster).toHaveBeenCalledOnce();
  });

  it('rejects a present MIME label unless it is the exact contract MIME', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([png(2, 2)], { type: 'application/octet-stream' }),
      { format: 'png', width: 2, height: 2, alpha: 'opaque' },
      { decodeRaster: async () => decoded(2, 2, [255]) },
    )).rejects.toThrow(/Blob MIME.*application\/octet-stream.*image\/png/);
  });

  it('rejects wrong signatures and embedded dimensions before identity can be claimed', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([jpeg(4, 4)], { type: 'image/png' }),
      { format: 'png', width: 4, height: 4, alpha: 'opaque' },
      { decodeRaster: async () => decoded(4, 4, [255]) },
    )).rejects.toThrow(/PNG signature/);
    await expect(validateArtifactBytesV1(
      new Blob([webp(5, 4)], { type: 'image/webp' }),
      { format: 'webp', width: 4, height: 4, alpha: 'opaque' },
      { decodeRaster: async () => decoded(4, 4, [255]) },
    )).rejects.toThrow(/embedded dimensions 5x4.*requested 4x4/);
  });

  it('requires every decoded opaque pixel to have alpha 255', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([png(2, 2)], { type: 'image/png' }),
      { format: 'png', width: 2, height: 2, alpha: 'opaque' },
      { decodeRaster: async () => decoded(2, 2, [255, 254]) },
    )).rejects.toThrow(/opaque PNG decoded with alpha 254/);
  });

  it('requires transparent output to contain actual transparency and visible content', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([png(2, 2)], { type: 'image/png' }),
      { format: 'png', width: 2, height: 2, alpha: 'transparent' },
      { decodeRaster: async () => decoded(2, 2, [255]) },
    )).rejects.toThrow(/both transparent and visible/);
    await expect(validateArtifactBytesV1(
      new Blob([png(2, 2)], { type: 'image/png' }),
      { format: 'png', width: 2, height: 2, alpha: 'transparent' },
      { decodeRaster: async () => decoded(2, 2, [0]) },
    )).rejects.toThrow(/both transparent and visible/);
    await expect(validateArtifactBytesV1(
      new Blob([png(2, 2)], { type: 'image/png' }),
      { format: 'png', width: 2, height: 2, alpha: 'transparent' },
      { decodeRaster: async () => decoded(2, 2, [254]) },
    )).rejects.toThrow(/fully transparent alpha-0 background pixel/);
    await expect(validateArtifactBytesV1(
      new Blob([png(2, 2)], { type: 'image/png' }),
      { format: 'png', width: 2, height: 2, alpha: 'transparent' },
      { decodeRaster: async () => decoded(2, 2, [0, 255]) },
    )).resolves.toMatchObject({ width: 2, height: 2 });
  });
});

describe('model artifact byte conformance', () => {
  it('validates GLB v2 JSON and exact chunk bounds', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([glb()]),
      { format: 'glb', alpha: 'not-applicable' },
    )).resolves.toMatchObject({ mimeType: 'model/gltf-binary' });

    const wrongLength = glb();
    new DataView(wrongLength.buffer).setUint32(8, wrongLength.byteLength + 4, true);
    await expect(validateArtifactBytesV1(
      new Blob([wrongLength], { type: 'model/gltf-binary' }),
      { format: 'glb', alpha: 'not-applicable' },
    )).rejects.toThrow(/declared length/);

    const overflowingChunk = glb();
    new DataView(overflowingChunk.buffer).setUint32(12, overflowingChunk.byteLength, true);
    await expect(validateArtifactBytesV1(
      new Blob([overflowingChunk], { type: 'model/gltf-binary' }),
      { format: 'glb', alpha: 'not-applicable' },
    )).rejects.toThrow(/chunk 0.*exceeds/);
  });

  it('validates a stored, aligned USDZ with a readable root and referenced layer', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([usdz()]),
      { format: 'usdz', alpha: 'not-applicable' },
    )).resolves.toMatchObject({ mimeType: 'model/vnd.usdz+zip' });
  });

  it('rejects USDZ traversal paths and missing root-layer references', async () => {
    await expect(validateArtifactBytesV1(
      new Blob([usdz({ geometryName: '../Geometry.usda', reference: '../Geometry.usda' })]),
      { format: 'usdz', alpha: 'not-applicable' },
    )).rejects.toThrow(/traversal|unsafe package path/);

    await expect(validateArtifactBytesV1(
      new Blob([usdz({ reference: 'geometries/Missing.usda' })]),
      { format: 'usdz', alpha: 'not-applicable' },
    )).rejects.toThrow(/references missing package entry/);
  });

  it('rejects USDZ bytes whose CRC no longer matches their package metadata', async () => {
    const bytes = usdz();
    bytes[64] ^= 0xff;
    await expect(validateArtifactBytesV1(
      new Blob([bytes], { type: 'model/vnd.usdz+zip' }),
      { format: 'usdz', alpha: 'not-applicable' },
    )).rejects.toThrow(/CRC check failed/);
  });
});
