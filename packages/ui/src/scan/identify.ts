import { LOCAL_MOLECULES } from '../landing/moleculeIndex';

/**
 * Browser half of the photo scanner. The page downsizes the photo, sends it
 * with the gallery pool to the edge, and shows whatever comes back. A
 * non-JSON or non-2xx reply is "no answer"; after the edge reports
 * `configured: false` once, the session stops asking and says so.
 *
 * The 3D viewer is never imported here: opening a molecule is a dynamic
 * import at click time, like the landing page's finder.
 */
export const SCAN_IDENTIFY_PATH = '/v1/scan/identify';
/** Longest a photo may be on its long edge before upload; plenty for vision, tiny on the wire. */
export const SCAN_MAX_EDGE = 1024;
const SCAN_JPEG_QUALITY = 0.85;
/** The edge times out at 14 s; give transport a little more. */
const SCAN_TIMEOUT_MS = 20_000;

export interface PreparedImage {
  blob: Blob;
  /** Object URL for the preview; the page revokes it. */
  previewUrl: string;
  base64: string;
  mediaType: 'image/jpeg';
  width: number;
  height: number;
  /** A small RGBA copy for the particle stage: the photo the particles are born from. */
  pixels: { width: number; height: number; data: Uint8ClampedArray; mask: Uint8Array };
}

/**
 * A rough object mask with no model: the background is whatever colour the
 * photo's border mostly is, and a pixel belongs to the object when it sits
 * far from that colour. Good enough on a table, a desk, or a wall, which is
 * where phones get pointed; the particles born inside it carry the photo's
 * colours onto the shape, the rest fade to the palette.
 */
export function photoMask(width: number, height: number, data: Uint8ClampedArray): Uint8Array {
  const mask = new Uint8Array(width * height);
  if (width < 4 || height < 4) return mask.fill(1);
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const border = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    reds.push(data[at]);
    greens.push(data[at + 1]);
    blues.push(data[at + 2]);
  };
  for (let x = 0; x < width; x += 1) {
    border(x, 0);
    border(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    border(0, y);
    border(width - 1, y);
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const bg = [median(reds), median(greens), median(blues)];
  let inside = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      const distance = Math.abs(data[at] - bg[0]) + Math.abs(data[at + 1] - bg[1]) + Math.abs(data[at + 2] - bg[2]);
      // The centre of the frame needs less contrast to count: that is where the object usually is.
      const centred = Math.hypot((x / width - 0.5) * 2, (y / height - 0.5) * 2) < 0.55;
      if (distance > (centred ? 70 : 110)) {
        mask[y * width + x] = 1;
        inside += 1;
      }
    }
  }
  // A flat photo with nothing standing out, or one that is all object, gets no mask.
  const share = inside / (width * height);
  if (share < 0.04 || share > 0.9) return mask.fill(1);
  return mask;
}

/** Long edge of the pixel copy the particles sample; 60k particles over 160×120 is a few per pixel. */
const PIXELS_MAX_EDGE = 160;

export interface ScanCandidate {
  key: string;
  title: string;
  formula?: string;
  elements: string[];
  atoms: number;
  source: 'gallery';
  /** The gallery id, for `openMolecule({ kind: 'gallery' })`. */
  galleryId: string;
  image?: string;
}

export interface ScanMolecule {
  name: string;
  formula: string;
  role: string;
  share: number | null;
}

export interface ScanMaterial {
  name: string;
  share: number;
  summary: string;
  molecules: ScanMolecule[];
}

export interface ScanIdentification {
  subject: string;
  confidence: number;
  guesses: Array<{ label: string; probability: number }>;
  headline: string;
  materials: ScanMaterial[];
  elements: string[];
  nothingToScan: boolean;
}

export interface ScanMatch {
  molecule: { name: string; formula: string; material: string };
  key: string;
  title: string;
  source: string;
  matchedBy: 'title' | 'formula';
}

export interface ScanResult {
  configured: boolean;
  model?: { vision: string; jev: string | null };
  identification?: ScanIdentification;
  matches?: ScanMatch[];
  jev?: { best: { key: string; confidence: number } | null; fit: Record<string, number>; intent?: { choice: string; confidence: number } } | null;
  timing?: { visionMs: number; jevMs: number | null; totalMs: number };
  cached?: boolean;
  error?: string;
  reason?: string;
}

export class ScanError extends Error {
  readonly status: number;
  readonly reason: string | null;
  constructor(message: string, status: number, reason: string | null = null) {
    super(message);
    this.name = 'ScanError';
    this.status = status;
    this.reason = reason;
  }
}

let unavailable = false;

export function resetScanAvailability(): void {
  unavailable = false;
}

export function scanUnavailable(): boolean {
  return unavailable;
}

/** Element symbols in a plain formula, in order of first appearance. */
export function elementsFromFormula(formula: string): string[] {
  const symbols = new Set<string>();
  for (const match of formula.matchAll(/([A-Z][a-z]?)/g)) symbols.add(match[1]);
  return [...symbols];
}

let poolCache: ScanCandidate[] | null = null;

/** Every directly openable gallery molecule, as the edge expects it. Built once. */
export function scanCandidates(): ScanCandidate[] {
  poolCache ??= LOCAL_MOLECULES.map((molecule) => ({
    key: `gallery:${molecule.id}`,
    title: molecule.title,
    formula: molecule.formula,
    elements: molecule.formula ? elementsFromFormula(molecule.formula) : [],
    atoms: molecule.atoms,
    source: 'gallery',
    galleryId: molecule.id,
    image: molecule.image,
  }));
  return poolCache;
}

async function decode(source: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(source, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to the element path (older Safari, unusual encodings).
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ScanError('That file is not an image the browser can read.', 400));
    };
    image.src = url;
  });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(new ScanError('Could not read the photo.', 400));
    reader.readAsDataURL(blob);
  });
}

/** Downscale to a JPEG no larger than `SCAN_MAX_EDGE` on its long edge, keeping EXIF orientation. */
export async function prepareImage(source: Blob, maxEdge = SCAN_MAX_EDGE): Promise<PreparedImage> {
  const decoded = await decode(source);
  const sourceWidth = 'naturalWidth' in decoded ? decoded.naturalWidth : decoded.width;
  const sourceHeight = 'naturalHeight' in decoded ? decoded.naturalHeight : decoded.height;
  if (!sourceWidth || !sourceHeight) throw new ScanError('That image is empty.', 400);
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new ScanError('This browser cannot resize the photo.', 400);
  context.drawImage(decoded, 0, 0, width, height);
  if ('close' in decoded) decoded.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', SCAN_JPEG_QUALITY));
  if (!blob) throw new ScanError('Could not encode the photo.', 400);
  const pixelScale = Math.min(1, PIXELS_MAX_EDGE / Math.max(width, height));
  const pixelWidth = Math.max(1, Math.round(width * pixelScale));
  const pixelHeight = Math.max(1, Math.round(height * pixelScale));
  const small = document.createElement('canvas');
  small.width = pixelWidth;
  small.height = pixelHeight;
  const smallContext = small.getContext('2d', { willReadFrequently: true });
  smallContext?.drawImage(canvas, 0, 0, pixelWidth, pixelHeight);
  const pixels = smallContext ? smallContext.getImageData(0, 0, pixelWidth, pixelHeight) : null;
  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    base64: await blobToBase64(blob),
    mediaType: 'image/jpeg',
    width,
    height,
    pixels: pixels
      ? { width: pixelWidth, height: pixelHeight, data: pixels.data, mask: photoMask(pixelWidth, pixelHeight, pixels.data) }
      : { width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]), mask: new Uint8Array([1]) },
  };
}

export interface IdentifyRequest {
  image: PreparedImage;
  hint?: string;
  candidates?: ScanCandidate[];
}

/** One round trip. Throws `ScanError` on a failure the page should show. */
export async function identifyScan(request: IdentifyRequest, signal?: AbortSignal): Promise<ScanResult> {
  if (unavailable) return { configured: false };
  if (typeof fetch !== 'function') throw new ScanError('This browser cannot reach the scanner.', 0);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(SCAN_IDENTIFY_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        image: { mediaType: request.image.mediaType, data: request.image.base64 },
        hint: request.hint?.trim() || undefined,
        candidates: (request.candidates ?? scanCandidates()).map((candidate) => ({
          key: candidate.key,
          title: candidate.title,
          formula: candidate.formula,
          elements: candidate.elements,
          atoms: candidate.atoms || undefined,
          source: candidate.source,
        })),
      }),
    });
    if (!(response.headers.get('content-type') ?? '').includes('application/json')) {
      unavailable = true;
      return { configured: false };
    }
    const payload = (await response.json()) as ScanResult;
    if (payload.configured === false) {
      unavailable = true;
      return payload;
    }
    if (!response.ok) throw new ScanError(payload.error ?? `The scanner answered ${response.status}.`, response.status, payload.reason ?? null);
    return payload;
  } catch (error) {
    if (error instanceof ScanError) throw error;
    if (controller.signal.aborted && !signal?.aborted) throw new ScanError('The scan took too long. Try a closer, brighter photo.', 504, 'timeout');
    if (signal?.aborted) throw new ScanError('Scan cancelled.', 0, 'cancelled');
    throw new ScanError('The scanner is unreachable right now.', 0, 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Fun lines to cycle while the swirl runs; nothing here claims a result. */
export const SCAN_STATUS_LINES = [
  'Looking closely…',
  'Counting atoms…',
  'Sorting the molecules…',
  'Asking Jev which one to open first…',
  'Almost there…',
] as const;
