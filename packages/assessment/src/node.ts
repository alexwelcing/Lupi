import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ByteSource } from './types';
import { sampleFingerprint } from './sources';

export async function byteSourceFromPath(filePath: string): Promise<ByteSource> {
  const absolutePath = path.resolve(filePath);
  const info = await stat(absolutePath);
  if (!info.isFile()) throw new Error(`Assessment input is not a file: ${absolutePath}`);
  let fingerprint = '';
  const rangeCache: Array<{ start: number; end: number; bytes: Uint8Array }> = [];
  const source: ByteSource = {
    kind: 'bytes',
    name: path.basename(absolutePath),
    size: info.size,
    locality: 'local',
    async readRange(start, endExclusive) {
      const length = Math.max(0, Math.min(info.size, endExclusive) - Math.max(0, start));
      if (!length) return new Uint8Array();
      const requestedEnd = start + length;
      const cached = rangeCache.find((entry) => start >= entry.start && requestedEnd <= entry.end);
      if (cached) return cached.bytes.slice(start - cached.start, requestedEnd - cached.start);
      const handle = await open(absolutePath, 'r');
      try {
        const buffer = Buffer.allocUnsafe(length);
        const { bytesRead } = await handle.read(buffer, 0, length, start);
        const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead).slice();
        rangeCache.push({ start, end: start + bytes.byteLength, bytes });
        if (start === 0) fingerprint = sampleFingerprint(bytes);
        return bytes.slice();
      } finally {
        await handle.close();
      }
    },
    async *openStream() {
      const stream = createReadStream(absolutePath, { highWaterMark: 256 * 1024 });
      for await (const chunk of stream) {
        const buffer = chunk as Buffer;
        yield new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      }
    },
    async contentHash() {
      const hash = createHash('sha256');
      const stream = createReadStream(absolutePath, { highWaterMark: 1024 * 1024 });
      for await (const chunk of stream) hash.update(chunk as Buffer);
      return hash.digest('hex');
    },
  };
  Object.defineProperty(source, 'cacheKey', {
    enumerable: true,
    get: () => `file:${normalizePath(absolutePath)}:${info.size}:${info.mtimeMs}:${fingerprint || 'unsampled'}`,
  });
  return source;
}

export async function byteSourcesFromPath(
  inputPath: string,
  options: { recursive?: boolean; includeHidden?: boolean } = {},
): Promise<ByteSource[]> {
  const absolutePath = path.resolve(inputPath);
  const info = await stat(absolutePath);
  if (info.isFile()) return [await byteSourceFromPath(absolutePath)];
  if (!info.isDirectory()) throw new Error(`Assessment input is neither a file nor directory: ${absolutePath}`);
  const files: string[] = [];
  await collectFiles(absolutePath, files, options.recursive !== false, options.includeHidden === true);
  const sources: ByteSource[] = [];
  for (const file of files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) sources.push(await byteSourceFromPath(file));
  return sources;
}

async function collectFiles(directory: string, files: string[], recursive: boolean, includeHidden: boolean) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!includeHidden && entry.name.startsWith('.')) continue;
    const child = path.join(directory, entry.name);
    if (entry.isFile()) files.push(child);
    else if (recursive && entry.isDirectory()) await collectFiles(child, files, recursive, includeHidden);
  }
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase();
}
