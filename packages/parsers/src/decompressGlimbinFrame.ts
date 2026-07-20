const GZIP_MAGIC = [0x1f, 0x8b] as const;
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;
const MAX_RAW_FRAME_BYTES = 512 * 1024 * 1024;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return bytes.byteLength >= magic.length && magic.every((byte, index) => bytes[index] === byte);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Decode a frame whose glimbin header declares compression. */
export async function decompressGlimbinFrame(
  buffer: ArrayBuffer,
  expectedRawSize: number,
): Promise<ArrayBuffer> {
  if (!Number.isSafeInteger(expectedRawSize) || expectedRawSize < 0 || expectedRawSize > MAX_RAW_FRAME_BYTES) {
    throw new Error(`Invalid glimbin raw frame size: ${expectedRawSize}`);
  }

  const bytes = new Uint8Array(buffer);
  if (startsWith(bytes, ZSTD_MAGIC)) {
    throw new Error(
      'Frame decompression failed: this glimbin frame uses zstd, but the format does not yet declare codecs and this reader currently supports gzip only.',
    );
  }
  if (!startsWith(bytes, GZIP_MAGIC)) {
    throw new Error(
      'Frame decompression failed: the file declares a compressed frame, but its bytes do not have gzip framing.',
    );
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error(
      'Frame decompression failed: this runtime does not provide gzip DecompressionStream support.',
    );
  }

  let decoded: Uint8Array;
  try {
    const stream = new DecompressionStream('gzip');
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const writeAndClose = (async () => {
      await writer.write(bytes);
      await writer.close();
    })();
    const readAll = (async () => {
      const chunks: Uint8Array[] = [];
      let totalLength = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalLength += value.byteLength;
        if (totalLength > expectedRawSize) {
          await reader.cancel('Decoded glimbin frame exceeded its declared raw size.');
          throw new Error(
            `Decoded glimbin frame exceeded its declared raw size of ${expectedRawSize} bytes.`,
          );
        }
        chunks.push(value);
      }

      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return result;
    })();

    // Malformed streams may reject the writer and reader independently.
    // Observe both halves so neither rejection becomes detached/unhandled.
    const [writeResult, readResult] = await Promise.allSettled([writeAndClose, readAll]);
    if (readResult.status === 'rejected') throw readResult.reason;
    if (writeResult.status === 'rejected') throw writeResult.reason;
    decoded = readResult.value;
  } catch (error) {
    throw new Error(
      `Frame decompression failed: gzip decoding did not complete. Underlying: ${errorMessage(error)}`,
    );
  }

  if (decoded.byteLength !== expectedRawSize) {
    throw new Error(
      `Frame decompression failed: expected ${expectedRawSize} raw bytes, but gzip produced ${decoded.byteLength}.`,
    );
  }
  const output = new ArrayBuffer(decoded.byteLength);
  new Uint8Array(output).set(decoded);
  return output;
}
