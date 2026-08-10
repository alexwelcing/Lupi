import type {
  AssetEnvelope,
  ByteSource,
  EnvelopeSource,
  TrajectorySource,
} from './types';
import type { Trajectory } from '@atlas/core/types';

const DEFAULT_REMOTE_LIMIT = 128 * 1024;

export interface RemoteByteSourceOptions {
  timeoutMs?: number;
  maxBytes?: number;
  requireHttps?: boolean;
  allowedOrigins?: string[];
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
  allowPrivate?: boolean;
}

export interface EnvelopeSourceOptions {
  /**
   * Caller-verified identity for the complete immutable envelope payload.
   * Assessment context is keyed separately by the CLI; mutable record IDs are
   * not content identities.
   */
  immutableContentId?: string;
}

export function byteSourceFromBytes(bytes: Uint8Array, name = 'memory.bin'): ByteSource {
  const stable = bytes.slice();
  return {
    kind: 'bytes',
    name,
    size: stable.byteLength,
    locality: 'memory',
    cacheKey: `memory:${name}:${stable.byteLength}:${sampleFingerprint(stable)}`,
    async readRange(start, endExclusive) {
      return stable.slice(Math.max(0, start), Math.max(start, endExclusive));
    },
    async *openStream() {
      yield stable;
    },
    async contentHash() {
      return sha256Hex(stable);
    },
  };
}

export function byteSourceFromText(text: string, name = 'memory.txt'): ByteSource {
  return byteSourceFromBytes(new TextEncoder().encode(text), name);
}

export function byteSourceFromBlob(blob: Blob, name = 'blob.bin'): ByteSource {
  return {
    kind: 'bytes',
    name,
    size: blob.size,
    locality: 'memory',
    // Name and size do not identify immutable content. Callers may still use
    // contentHash(), but the generic local cache must not alias two same-sized
    // browser files that happen to share a filename.
    cacheKey: undefined,
    async readRange(start, endExclusive) {
      return new Uint8Array(await blob.slice(start, endExclusive).arrayBuffer());
    },
    async *openStream() {
      const reader = blob.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.byteLength) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    async contentHash() {
      return sha256Hex(new Uint8Array(await blob.arrayBuffer()));
    },
  };
}

export function byteSourceFromStream(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  name = 'stream.bin',
  size?: number,
): ByteSource {
  const iterator = isReadableStream(stream)
    ? readableStreamIterator(stream)
    : stream[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let finished = false;

  async function fillTo(target: number) {
    while (!finished && buffered < target) {
      const next = await iterator.next();
      if (next.done) {
        finished = true;
        break;
      }
      const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
      chunks.push(chunk);
      buffered += chunk.byteLength;
    }
  }

  function combined(limit = buffered) {
    const output = new Uint8Array(Math.min(limit, buffered));
    let offset = 0;
    for (const chunk of chunks) {
      if (offset >= output.length) break;
      const take = Math.min(chunk.byteLength, output.length - offset);
      output.set(chunk.subarray(0, take), offset);
      offset += take;
    }
    return output;
  }

  return {
    kind: 'bytes',
    name,
    size,
    locality: 'memory',
    async readRange(start, endExclusive) {
      await fillTo(endExclusive);
      return combined(endExclusive).slice(start, endExclusive);
    },
    async *openStream() {
      for (const chunk of chunks) yield chunk;
      while (!finished) {
        const next = await iterator.next();
        if (next.done) {
          finished = true;
          break;
        }
        const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value);
        chunks.push(chunk);
        buffered += chunk.byteLength;
        yield chunk;
      }
    },
  };
}

export function trajectorySource(
  trajectory: Trajectory,
  options: { name?: string; size?: number; cacheKey?: string; sidecars?: { thermo?: boolean; profiles?: boolean } } = {},
): TrajectorySource {
  return {
    kind: 'trajectory',
    name: options.name ?? 'active-trajectory',
    trajectory,
    size: options.size,
    cacheKey: options.cacheKey,
    sidecars: options.sidecars,
  };
}

export function envelopeSource(
  envelope: AssetEnvelope,
  name?: string,
  options: EnvelopeSourceOptions = {},
): EnvelopeSource {
  const immutableContentId = options.immutableContentId?.trim();
  return {
    kind: 'envelope',
    name: name ?? envelope.name ?? envelope.id ?? 'asset-envelope',
    envelope,
    cacheKey: immutableContentId
      ? `envelope:${envelope.schema ?? 'unknown'}:${immutableContentId}`
      : undefined,
  };
}

export function byteSourceFromUrl(urlValue: string, options: RemoteByteSourceOptions = {}): ByteSource {
  const url = new URL(urlValue);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = Math.max(100, options.timeoutMs ?? 5_000);
  const maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_REMOTE_LIMIT);
  const maxRedirects = Math.max(0, options.maxRedirects ?? 3);
  const allowedOrigins = options.allowedOrigins?.map((origin) => new URL(origin).origin);
  assertSafeRemoteUrl(url, { requireHttps: options.requireHttps, allowedOrigins, allowPrivate: options.allowPrivate });

  let knownSize: number | undefined;
  let validator = '';
  let fingerprint = '';
  let deadlineMs: number | undefined;
  const rangeCache: Array<{ start: number; end: number; bytes: Uint8Array }> = [];

  async function fetchRange(start: number, endExclusive: number): Promise<{ response: Response; finish(): void }> {
    let current = url;
    for (let redirects = 0; redirects <= maxRedirects; redirects++) {
      assertSafeRemoteUrl(current, { requireHttps: options.requireHttps, allowedOrigins, allowPrivate: options.allowPrivate });
      deadlineMs ??= Date.now() + timeoutMs;
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) throw new Error(`Remote assessment exceeded its ${timeoutMs}ms timeout.`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), remainingMs);
      let handoffTimer = false;
      try {
        const response = await fetchImpl(current, {
          headers: { Range: `bytes=${start}-${Math.max(start, endExclusive - 1)}` },
          redirect: 'manual',
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location || redirects === maxRedirects) throw new Error('Remote assessment redirect could not be followed safely.');
          current = new URL(location, current);
          continue;
        }
        if (!response.ok) throw new Error(`Remote assessment fetch failed with HTTP ${response.status}.`);
        const contentRange = response.headers.get('content-range');
        const rangeSize = contentRange?.match(/\/(\d+)$/)?.[1];
        const contentLength = response.headers.get('content-length');
        knownSize = rangeSize ? Number(rangeSize) : contentLength ? Number(contentLength) : knownSize;
        validator = [
          response.headers.get('etag'),
          response.headers.get('last-modified'),
          knownSize,
        ].filter(Boolean).join(':');
        handoffTimer = true;
        return { response, finish: () => clearTimeout(timer) };
      } finally {
        if (!handoffTimer) clearTimeout(timer);
      }
    }
    throw new Error('Remote assessment exceeded redirect limit.');
  }

  const source: ByteSource = {
    kind: 'bytes',
    name: url.pathname.split('/').pop() || url.hostname,
    locality: 'remote',
    cacheKey: `url:${url.href}`,
    get size() { return knownSize; },
    async readRange(start, endExclusive) {
      const length = Math.min(maxBytes, Math.max(0, endExclusive - start));
      if (length === 0) return new Uint8Array();
      const requestedEnd = start + length;
      const cached = rangeCache.find((entry) => start >= entry.start && requestedEnd <= entry.end);
      if (cached) return cached.bytes.slice(start - cached.start, requestedEnd - cached.start);
      const fetched = await fetchRange(start, start + length);
      let bytes: Uint8Array;
      try {
        if (fetched.response.status !== 206 && start > 0) {
          await fetched.response.body?.cancel().catch(() => {});
          throw new Error('Remote assessment origin ignored a non-zero byte range; bounded random access is unavailable.');
        }
        if (fetched.response.status === 206) {
          const contentRange = fetched.response.headers.get('content-range');
          const match = /^bytes\s+(\d+)-(\d+)\/(?:\d+|\*)$/i.exec(contentRange ?? '');
          const returnedStart = match ? Number(match[1]) : Number.NaN;
          const returnedEnd = match ? Number(match[2]) : Number.NaN;
          const requestedEnd = start + length - 1;
          if (!match
            || returnedStart !== start
            || !Number.isSafeInteger(returnedEnd)
            || returnedEnd < returnedStart
            || returnedEnd > requestedEnd) {
            await fetched.response.body?.cancel().catch(() => {});
            throw new Error('Remote assessment origin returned a mismatched byte range.');
          }
        }
        const responseBytes = await readResponsePrefix(fetched.response, length);
        bytes = responseBytes;
      } finally {
        fetched.finish();
      }
      rangeCache.push({ start, end: start + bytes.byteLength, bytes });
      if (start === 0) fingerprint = sampleFingerprint(bytes);
      return bytes.slice();
    },
    async *openStream() {
      const fetched = await fetchRange(0, maxBytes);
      if (!fetched.response.body) {
        try { yield await readResponsePrefix(fetched.response, maxBytes); }
        finally { fetched.finish(); }
        return;
      }
      const reader = fetched.response.body.getReader();
      let emitted = 0;
      try {
        while (emitted < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          const take = value.subarray(0, Math.min(value.byteLength, maxBytes - emitted));
          emitted += take.byteLength;
          if (take.byteLength) yield take;
        }
        if (emitted >= maxBytes) await reader.cancel();
      } finally {
        reader.releaseLock();
        fetched.finish();
      }
    },
  };
  Object.defineProperty(source, 'cacheKey', {
    enumerable: true,
    get: () => `url:${url.href}:${validator || 'unvalidated'}:${fingerprint || 'unsampled'}`,
  });
  return source;
}

export function assertSafeRemoteUrl(
  value: string | URL,
  options: { requireHttps?: boolean; allowedOrigins?: string[]; allowPrivate?: boolean } = {},
): URL {
  const url = value instanceof URL ? value : new URL(value);
  const protocolAllowed = options.requireHttps ? url.protocol === 'https:' : url.protocol === 'https:' || url.protocol === 'http:';
  if (!protocolAllowed) throw new Error('Remote assessment URL must use HTTP(S); edge assessment requires HTTPS.');
  if (url.username || url.password) throw new Error('Remote assessment URLs cannot contain credentials.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!options.allowPrivate && isPrivateHostname(hostname)) throw new Error('Remote assessment URL targets a local or private network address.');
  if (options.allowedOrigins?.length && !options.allowedOrigins.includes(url.origin)) {
    throw new Error(`Remote assessment origin is not permitted: ${url.origin}`);
  }
  return url;
}

export function sampleFingerprint(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const view = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', view as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function readResponsePrefix(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.slice(0, limit);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, Math.min(value.byteLength, limit - total));
      chunks.push(take);
      total += take.byteLength;
    }
    if (total >= limit) await reader.cancel();
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return Boolean(value && typeof (value as ReadableStream<Uint8Array>).getReader === 'function');
}

async function* readableStreamIterator(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isPrivateHostname(hostname: string): boolean {
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) return true;
  if (hostname === '::1' || hostname === '::' || /^f[cd][0-9a-f:]*$/i.test(hostname) || /^fe[89ab][0-9a-f:]*$/i.test(hostname)) return true;
  const mappedIpv4 = ipv4MappedAddress(hostname);
  if (mappedIpv4) return isPrivateHostname(mappedIpv4);
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map(Number);
  if (parts.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function ipv4MappedAddress(hostname: string): string | undefined {
  const dotted = hostname.match(/^(?:::ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (dotted) return dotted;
  if (!hostname.includes(':') || hostname.includes('.')) return undefined;

  const doubleColon = hostname.indexOf('::');
  if (doubleColon !== hostname.lastIndexOf('::')) return undefined;
  const left = doubleColon >= 0 ? hostname.slice(0, doubleColon) : hostname;
  const right = doubleColon >= 0 ? hostname.slice(doubleColon + 2) : '';
  const leftWords = left ? left.split(':') : [];
  const rightWords = right ? right.split(':') : [];
  const missing = doubleColon >= 0 ? 8 - leftWords.length - rightWords.length : 0;
  if (missing < 0 || (doubleColon < 0 && leftWords.length !== 8)) return undefined;
  const rawWords = doubleColon >= 0
    ? [...leftWords, ...Array.from({ length: missing }, () => '0'), ...rightWords]
    : leftWords;
  if (rawWords.length !== 8 || rawWords.some((word) => !/^[0-9a-f]{1,4}$/i.test(word))) return undefined;
  const words = rawWords.map((word) => Number.parseInt(word, 16));
  if (words.slice(0, 5).some((word) => word !== 0) || words[5] !== 0xffff) return undefined;
  return `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
}
