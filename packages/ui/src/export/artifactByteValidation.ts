/**
 * Runtime byte-level validation for artifacts emitted by the browser viewer.
 *
 * Exporters are an untrusted boundary: a successful callback and a Blob label
 * do not prove that the bytes match the requested artifact. Keep every check
 * in this module browser-safe so MCP never returns content identities for
 * malformed, mislabeled, wrong-sized, or wrong-alpha output.
 */

export type ArtifactByteFormatV1 = 'png' | 'jpeg' | 'webp' | 'glb' | 'usdz';
export type ArtifactAlphaModeV1 = 'opaque' | 'transparent' | 'not-applicable';

export interface ArtifactByteValidationIntentV1 {
  format: ArtifactByteFormatV1;
  width?: number;
  height?: number;
  alpha: ArtifactAlphaModeV1;
}

export interface DecodedRasterV1 {
  width: number;
  height: number;
  /** RGBA8 pixels, exactly width * height * 4 bytes. */
  pixels: Uint8ClampedArray;
}

export interface ArtifactByteValidationHooksV1 {
  /** Test seam. Production callers use the browser decoder below. */
  decodeRaster?: (blob: Blob) => Promise<DecodedRasterV1>;
}

export interface ValidatedArtifactBytesV1 {
  bytes: Uint8Array;
  mimeType: string;
  width?: number;
  height?: number;
}

const MIME_BY_FORMAT: Record<ArtifactByteFormatV1, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const ZIP_LOCAL_FILE = 0x04034b50;
const ZIP_CENTRAL_FILE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const GLB_JSON_CHUNK = 0x4e4f534a;

function fail(message: string): never {
  throw new Error(`Artifact byte validation failed: ${message}`);
}

function requireBounds(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0
    || offset + length > bytes.byteLength) {
    fail(`${label} exceeds the ${bytes.byteLength}-byte artifact.`);
  }
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  requireBounds(bytes, start, end - start, 'ASCII field');
  let value = '';
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]);
  return value;
}

function bytesEqual(bytes: Uint8Array, expected: readonly number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function assertRequestedDimensions(
  actual: { width: number; height: number },
  intent: ArtifactByteValidationIntentV1,
): void {
  if (!Number.isSafeInteger(intent.width) || !Number.isSafeInteger(intent.height)
    || (intent.width as number) <= 0 || (intent.height as number) <= 0) {
    fail(`${intent.format.toUpperCase()} validation requires positive integer requested dimensions.`);
  }
  if (actual.width !== intent.width || actual.height !== intent.height) {
    fail(
      `${intent.format.toUpperCase()} embedded dimensions ${actual.width}x${actual.height} `
      + `do not match the requested ${intent.width}x${intent.height}.`,
    );
  }
}

function validatePng(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 45 || !bytesEqual(bytes, PNG_SIGNATURE)) fail('PNG signature is missing or truncated.');
  const view = viewOf(bytes);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;

  while (offset < bytes.byteLength) {
    requireBounds(bytes, offset, 12, 'PNG chunk header');
    const length = view.getUint32(offset, false);
    const type = ascii(bytes, offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    requireBounds(bytes, dataStart, length + 4, `PNG ${type} chunk`);

    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) fail('PNG must begin with a 13-byte IHDR chunk.');
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      if (width === 0 || height === 0) fail('PNG IHDR dimensions must be non-zero.');
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0 || bytes[dataStart + 12] > 1) {
        fail('PNG IHDR uses unsupported compression, filter, or interlace values.');
      }
      sawHeader = true;
    } else if (type === 'IHDR') {
      fail('PNG contains more than one IHDR chunk.');
    }

    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      if (length !== 0) fail('PNG IEND chunk must be empty.');
      sawEnd = true;
      offset = dataEnd + 4;
      if (offset !== bytes.byteLength) fail('PNG has trailing bytes after IEND.');
      break;
    }
    offset = dataEnd + 4;
  }

  if (!sawHeader || !sawImageData || !sawEnd) fail('PNG is missing IHDR, IDAT, or IEND structure.');
  return { width, height };
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function validateJpeg(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('JPEG SOI signature is missing.');
  if (bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9) {
    fail('JPEG EOI signature is missing or is followed by trailing bytes.');
  }
  const view = viewOf(bytes);
  let offset = 2;
  while (offset < bytes.byteLength - 2) {
    if (bytes[offset] !== 0xff) fail(`JPEG marker prefix is missing at byte ${offset}.`);
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) fail('JPEG marker is truncated.');
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x00) fail('JPEG contains an escaped byte outside scan data.');
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9) break;
    if (marker === 0xda) fail('JPEG reached scan data before a supported SOF marker.');
    requireBounds(bytes, offset, 2, 'JPEG segment length');
    const segmentLength = view.getUint16(offset, false);
    if (segmentLength < 2) fail(`JPEG marker 0x${marker.toString(16)} has an invalid segment length.`);
    requireBounds(bytes, offset, segmentLength, `JPEG marker 0x${marker.toString(16)}`);
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) fail('JPEG SOF segment is too short.');
      const height = view.getUint16(offset + 3, false);
      const width = view.getUint16(offset + 5, false);
      if (width === 0 || height === 0) fail('JPEG SOF dimensions must be non-zero.');
      return { width, height };
    }
    offset += segmentLength;
  }
  return fail('JPEG does not contain a supported SOF dimension marker.');
}

function webpUint24(bytes: Uint8Array, offset: number): number {
  requireBounds(bytes, offset, 3, 'WebP 24-bit field');
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function validateWebp(bytes: Uint8Array): { width: number; height: number } {
  if (bytes.byteLength < 30 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 12) !== 'WEBP') {
    fail('WebP RIFF/WEBP signature is missing or truncated.');
  }
  const view = viewOf(bytes);
  const declaredLength = view.getUint32(4, true) + 8;
  if (declaredLength !== bytes.byteLength) {
    fail(`WebP RIFF length ${declaredLength} does not match ${bytes.byteLength} bytes.`);
  }

  let offset = 12;
  let canvasDimensions: { width: number; height: number } | undefined;
  let imageDimensions: { width: number; height: number } | undefined;
  let sawImagePayload = false;
  while (offset < bytes.byteLength) {
    requireBounds(bytes, offset, 8, 'WebP chunk header');
    const tag = ascii(bytes, offset, offset + 4);
    const length = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    requireBounds(bytes, dataStart, length, `WebP ${tag} chunk`);

    if (tag === 'VP8X') {
      if (length !== 10 || canvasDimensions) fail('WebP VP8X chunk is duplicated or not exactly 10 bytes.');
      canvasDimensions = {
        width: webpUint24(bytes, dataStart + 4) + 1,
        height: webpUint24(bytes, dataStart + 7) + 1,
      };
    } else if (tag === 'VP8 ') {
      if (length < 10 || !bytesEqual(bytes, [0x9d, 0x01, 0x2a], dataStart + 3)) {
        fail('WebP VP8 frame header is missing or truncated.');
      }
      imageDimensions = {
        width: view.getUint16(dataStart + 6, true) & 0x3fff,
        height: view.getUint16(dataStart + 8, true) & 0x3fff,
      };
      sawImagePayload = true;
    } else if (tag === 'VP8L') {
      if (length < 5 || bytes[dataStart] !== 0x2f) fail('WebP VP8L signature is missing or truncated.');
      const b0 = bytes[dataStart + 1];
      const b1 = bytes[dataStart + 2];
      const b2 = bytes[dataStart + 3];
      const b3 = bytes[dataStart + 4];
      imageDimensions = {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
      sawImagePayload = true;
    }
    offset = dataStart + length + (length & 1);
    if (offset > bytes.byteLength) fail(`WebP ${tag} padding exceeds the artifact.`);
  }

  if (offset !== bytes.byteLength || !sawImagePayload || (!canvasDimensions && !imageDimensions)) {
    fail('WebP chunk stream is incomplete or has no decodable image payload.');
  }
  if (canvasDimensions && imageDimensions
    && (canvasDimensions.width !== imageDimensions.width || canvasDimensions.height !== imageDimensions.height)) {
    fail('WebP VP8X canvas dimensions disagree with the embedded image frame.');
  }
  return canvasDimensions ?? imageDimensions!;
}

function validateGlb(bytes: Uint8Array): void {
  if (bytes.byteLength < 20 || ascii(bytes, 0, 4) !== 'glTF') fail('GLB magic is missing or truncated.');
  const view = viewOf(bytes);
  const version = view.getUint32(4, true);
  const declaredLength = view.getUint32(8, true);
  if (version !== 2) fail(`GLB version ${version} is not supported; expected version 2.`);
  if (declaredLength !== bytes.byteLength) {
    fail(`GLB declared length ${declaredLength} does not match ${bytes.byteLength} bytes.`);
  }

  let offset = 12;
  let chunkIndex = 0;
  let jsonDocument: Record<string, unknown> | undefined;
  while (offset < bytes.byteLength) {
    requireBounds(bytes, offset, 8, 'GLB chunk header');
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    if ((chunkLength & 3) !== 0) fail(`GLB chunk ${chunkIndex} length is not four-byte aligned.`);
    const dataStart = offset + 8;
    requireBounds(bytes, dataStart, chunkLength, `GLB chunk ${chunkIndex}`);
    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK) fail('GLB first chunk is not JSON.');
    if (chunkType === GLB_JSON_CHUNK) {
      if (jsonDocument) fail('GLB contains more than one JSON chunk.');
      try {
        const jsonText = new TextDecoder('utf-8', { fatal: true })
          .decode(bytes.subarray(dataStart, dataStart + chunkLength))
          .replace(/[\u0000\u0020\t\r\n]+$/g, '');
        jsonDocument = JSON.parse(jsonText) as Record<string, unknown>;
      } catch {
        fail('GLB JSON chunk is not readable UTF-8 JSON.');
      }
    }
    offset = dataStart + chunkLength;
    chunkIndex += 1;
  }
  if (offset !== bytes.byteLength || chunkIndex === 0 || !jsonDocument) fail('GLB chunk stream is incomplete.');
  const asset = jsonDocument.asset;
  if (!asset || typeof asset !== 'object' || (asset as { version?: unknown }).version !== '2.0') {
    fail('GLB JSON does not declare glTF asset version 2.0.');
  }
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
  for (let index = 0; index < bytes.byteLength; index += 1) {
    crc = crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function decodeZipName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) === 0 && bytes.some((value) => value > 0x7f)) {
    fail('USDZ entry name is non-ASCII without the ZIP UTF-8 flag.');
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('USDZ entry name is not valid UTF-8.');
  }
}

function assertSafePackagePath(name: string): void {
  if (!name || name.includes('\\') || /[\u0000-\u001f\u007f]/.test(name)
    || name.startsWith('/') || /^[a-z]:/i.test(name) || /%(?:2e|2f|5c)/i.test(name)) {
    fail(`USDZ contains unsafe package path ${JSON.stringify(name)}.`);
  }
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) {
    fail(`USDZ contains traversal or empty path component in ${JSON.stringify(name)}.`);
  }
}

function validateZipExtra(bytes: Uint8Array, label: string): void {
  const view = viewOf(bytes);
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + 4 > bytes.byteLength) fail(`${label} contains a truncated ZIP extra-field header.`);
    const length = view.getUint16(offset + 2, true);
    if (offset + 4 + length > bytes.byteLength) fail(`${label} contains a truncated ZIP extra field.`);
    offset += 4 + length;
  }
}

interface ZipEntryV1 {
  name: string;
  localOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  crc: number;
  flags: number;
  compression: number;
  data?: Uint8Array;
  dataEnd?: number;
}

function findZipEnd(bytes: Uint8Array): number {
  const view = viewOf(bytes);
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === ZIP_END_OF_CENTRAL_DIRECTORY) return offset;
  }
  return fail('USDZ ZIP end-of-central-directory record is missing.');
}

function validateUsdz(bytes: Uint8Array): void {
  if (bytes.byteLength < 22 || viewOf(bytes).getUint32(0, true) !== ZIP_LOCAL_FILE) {
    fail('USDZ ZIP local-file signature is missing or truncated.');
  }
  const view = viewOf(bytes);
  const endOffset = findZipEnd(bytes);
  requireBounds(bytes, endOffset, 22, 'USDZ end-of-central-directory record');
  const disk = view.getUint16(endOffset + 4, true);
  const centralDisk = view.getUint16(endOffset + 6, true);
  const diskEntries = view.getUint16(endOffset + 8, true);
  const totalEntries = view.getUint16(endOffset + 10, true);
  const centralSize = view.getUint32(endOffset + 12, true);
  const centralOffset = view.getUint32(endOffset + 16, true);
  const commentLength = view.getUint16(endOffset + 20, true);
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) fail('USDZ must be a single-disk ZIP archive.');
  if (totalEntries === 0 || centralOffset === 0xffffffff || centralSize === 0xffffffff) {
    fail('USDZ ZIP is empty or requires unsupported ZIP64 metadata.');
  }
  if (centralOffset + centralSize !== endOffset || endOffset + 22 + commentLength !== bytes.byteLength) {
    fail('USDZ central-directory or archive-comment bounds are inconsistent.');
  }

  const entries: ZipEntryV1[] = [];
  const names = new Set<string>();
  const foldedNames = new Set<string>();
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    requireBounds(bytes, offset, 46, `USDZ central entry ${index}`);
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_FILE) fail(`USDZ central entry ${index} has no file signature.`);
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const entryCommentLength = view.getUint16(offset + 32, true);
    const startDisk = view.getUint16(offset + 34, true);
    const localOffset = view.getUint32(offset + 42, true);
    const recordLength = 46 + nameLength + extraLength + entryCommentLength;
    requireBounds(bytes, offset, recordLength, `USDZ central entry ${index}`);
    const name = decodeZipName(bytes.subarray(offset + 46, offset + 46 + nameLength), flags);
    assertSafePackagePath(name);
    const foldedName = name.toLocaleLowerCase('en-US');
    if (names.has(name) || foldedNames.has(foldedName)) {
      fail(`USDZ contains duplicate or case-colliding package path ${JSON.stringify(name)}.`);
    }
    names.add(name);
    foldedNames.add(foldedName);
    validateZipExtra(
      bytes.subarray(offset + 46 + nameLength, offset + 46 + nameLength + extraLength),
      `USDZ central entry ${JSON.stringify(name)}`,
    );
    if ((flags & 0x0009) !== 0 || compression !== 0 || compressedSize !== uncompressedSize || startDisk !== 0) {
      fail(`USDZ entry ${JSON.stringify(name)} is encrypted, streamed, compressed, or split across disks.`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      fail(`USDZ entry ${JSON.stringify(name)} requires unsupported ZIP64 metadata.`);
    }
    entries.push({ name, localOffset, compressedSize, uncompressedSize, crc, flags, compression });
    offset += recordLength;
  }
  if (offset !== centralOffset + centralSize) fail('USDZ central-directory entry count or size is inconsistent.');

  const byLocalOffset = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  let localCursor = 0;
  for (const entry of byLocalOffset) {
    if (entry.localOffset !== localCursor) fail(`USDZ has an unexplained gap before ${JSON.stringify(entry.name)}.`);
    requireBounds(bytes, entry.localOffset, 30, `USDZ local header for ${entry.name}`);
    if (view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_FILE) {
      fail(`USDZ local header for ${JSON.stringify(entry.name)} has no file signature.`);
    }
    const localFlags = view.getUint16(entry.localOffset + 6, true);
    const localCompression = view.getUint16(entry.localOffset + 8, true);
    const localCrc = view.getUint32(entry.localOffset + 14, true);
    const localCompressedSize = view.getUint32(entry.localOffset + 18, true);
    const localUncompressedSize = view.getUint32(entry.localOffset + 22, true);
    const nameLength = view.getUint16(entry.localOffset + 26, true);
    const extraLength = view.getUint16(entry.localOffset + 28, true);
    const nameStart = entry.localOffset + 30;
    requireBounds(bytes, nameStart, nameLength + extraLength, `USDZ local name for ${entry.name}`);
    const localName = decodeZipName(bytes.subarray(nameStart, nameStart + nameLength), localFlags);
    validateZipExtra(
      bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength),
      `USDZ local entry ${JSON.stringify(entry.name)}`,
    );
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + entry.compressedSize;
    requireBounds(bytes, dataStart, entry.compressedSize, `USDZ data for ${entry.name}`);
    if (localName !== entry.name || localFlags !== entry.flags || localCompression !== entry.compression
      || localCrc !== entry.crc || localCompressedSize !== entry.compressedSize
      || localUncompressedSize !== entry.uncompressedSize) {
      fail(`USDZ central and local metadata disagree for ${JSON.stringify(entry.name)}.`);
    }
    if ((dataStart & 63) !== 0) fail(`USDZ entry ${JSON.stringify(entry.name)} is not 64-byte aligned.`);
    const data = bytes.subarray(dataStart, dataEnd);
    if (crc32(data) !== entry.crc) fail(`USDZ CRC check failed for ${JSON.stringify(entry.name)}.`);
    entry.data = data;
    entry.dataEnd = dataEnd;
    localCursor = dataEnd;
  }
  if (localCursor !== centralOffset) fail('USDZ local-file records do not end at the central directory.');

  const first = byLocalOffset[0];
  if (first.name !== 'model.usda' || !first.data) fail('USDZ first package entry must be the readable root layer model.usda.');
  let rootText: string;
  try {
    rootText = new TextDecoder('utf-8', { fatal: true }).decode(first.data);
  } catch {
    return fail('USDZ model.usda is not readable UTF-8.');
  }
  if (!rootText.startsWith('#usda 1.0') || !/\bdefaultPrim\s*=\s*"[^"]+"/.test(rootText)) {
    fail('USDZ model.usda lacks the USDA header or a defaultPrim declaration.');
  }
  const references = [...rootText.matchAll(/@([^@]+)@/g)].map((match) => match[1].replace(/^\.\//, ''));
  if (!references.some((reference) => reference.endsWith('.usda'))) {
    fail('USDZ model.usda does not reference any readable package geometry layer.');
  }
  for (const reference of references) {
    assertSafePackagePath(reference);
    const target = entries.find((entry) => entry.name === reference);
    if (!target?.data) fail(`USDZ model.usda references missing package entry ${JSON.stringify(reference)}.`);
    if (reference.endsWith('.usda')) {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(target.data);
      } catch {
        return fail(`USDZ referenced layer ${JSON.stringify(reference)} is not readable UTF-8.`);
      }
      if (!text.startsWith('#usda 1.0')) fail(`USDZ referenced layer ${JSON.stringify(reference)} lacks a USDA header.`);
    }
  }
}

function canvasPixels(source: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) fail('browser could not create a readable 2D canvas for alpha validation.');
  context.clearRect(0, 0, width, height);
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, width, height).data;
}

async function decodeRasterInBrowser(blob: Blob): Promise<DecodedRasterV1> {
  if (typeof createImageBitmap === 'function') {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(blob);
    } catch {
      return fail('browser decoder rejected the raster bytes.');
    }
    try {
      return { width: bitmap.width, height: bitmap.height, pixels: canvasPixels(bitmap, bitmap.width, bitmap.height) };
    } finally {
      bitmap.close();
    }
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined'
    || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return fail('no browser raster decoder is available for mandatory alpha validation.');
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    try {
      if (typeof image.decode === 'function') {
        image.src = url;
        await image.decode();
      } else {
        await new Promise<void>((resolve, reject) => {
          image.onload = () => resolve();
          image.onerror = () => reject(new Error('decode failed'));
          image.src = url;
        });
      }
    } catch {
      return fail('browser decoder rejected the raster bytes.');
    }
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (width === 0 || height === 0) fail('browser decoder returned zero raster dimensions.');
    return { width, height, pixels: canvasPixels(image, width, height) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function validateDecodedAlpha(decoded: DecodedRasterV1, intent: ArtifactByteValidationIntentV1): void {
  if (decoded.pixels.byteLength !== decoded.width * decoded.height * 4) {
    fail(`browser decoder returned ${decoded.pixels.byteLength} RGBA bytes for ${decoded.width}x${decoded.height}.`);
  }
  let sawFullyTransparent = false;
  let sawVisible = false;
  for (let index = 3; index < decoded.pixels.byteLength; index += 4) {
    const alpha = decoded.pixels[index];
    if (alpha === 0) sawFullyTransparent = true;
    if (alpha > 0) sawVisible = true;
    if (intent.alpha === 'opaque' && alpha !== 255) {
      fail(`opaque ${intent.format.toUpperCase()} decoded with alpha ${alpha} at pixel ${(index - 3) / 4}.`);
    }
  }
  if (intent.alpha === 'transparent' && (!sawFullyTransparent || !sawVisible)) {
    fail(
      `transparent ${intent.format.toUpperCase()} must contain both transparent and visible decoded pixels, `
      + 'including at least one fully transparent alpha-0 background pixel.',
    );
  }
}

/**
 * Validate a browser-exported Blob before computing or returning any content
 * identity. An empty Blob.type is allowed only because the byte signature is
 * independently sniffed; a present label must be the one exact contract MIME.
 */
export async function validateArtifactBytesV1(
  blob: Blob,
  intent: ArtifactByteValidationIntentV1,
  hooks: ArtifactByteValidationHooksV1 = {},
): Promise<ValidatedArtifactBytesV1> {
  const mimeType = MIME_BY_FORMAT[intent.format];
  if (blob.type !== '' && blob.type !== mimeType) {
    fail(`Blob MIME ${JSON.stringify(blob.type)} does not equal required ${JSON.stringify(mimeType)}.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength !== blob.size) fail('Blob bytes are empty or disagree with Blob.size.');

  let embeddedDimensions: { width: number; height: number } | undefined;
  if (intent.format === 'png') embeddedDimensions = validatePng(bytes);
  else if (intent.format === 'jpeg') embeddedDimensions = validateJpeg(bytes);
  else if (intent.format === 'webp') embeddedDimensions = validateWebp(bytes);
  else if (intent.format === 'glb') validateGlb(bytes);
  else validateUsdz(bytes);

  if (embeddedDimensions) {
    if (intent.alpha === 'not-applicable') fail(`${intent.format.toUpperCase()} requires an opaque or transparent alpha intent.`);
    assertRequestedDimensions(embeddedDimensions, intent);
    const decoded = await (hooks.decodeRaster ?? decodeRasterInBrowser)(blob);
    assertRequestedDimensions(decoded, intent);
    validateDecodedAlpha(decoded, intent);
  } else {
    if (intent.width !== undefined || intent.height !== undefined || intent.alpha !== 'not-applicable') {
      fail(`${intent.format.toUpperCase()} must use model dimensions and alpha intent.`);
    }
  }

  return {
    bytes,
    mimeType,
    ...(embeddedDimensions ?? {}),
  };
}
