/**
 * LupiText.tsx — 3D text labels for the WebGPU viewer (plan-final §5.9, D11).
 *
 * Replaces drei's troika `<Text>`, which drei 11 only ships from `/legacy`
 * (the WebGL build). The props are the troika-compatible subset the label
 * layers use (AnnotationsLayer, KnowledgeLabelsLayer, MeasurementLayer).
 *
 * Each label is a canvas-texture sprite: the text is rasterized once into a
 * 2D canvas (an outline with `strokeText`, then the fill with `fillText`),
 * uploaded as an sRGB `CanvasTexture`, and drawn on a plane with a
 * `MeshBasicNodeMaterial`, so it renders the same on WebGPU and on the WebGL2
 * fallback. Like troika's Text, the plane lies in the local XY plane facing
 * +Z; call sites billboard it with drei's `<Billboard>`.
 *
 * - Size: `fontSize` is the em height in world units. The texture holds
 *   64 px per em × min(devicePixelRatio, 2) (fewer when a very long label
 *   would exceed the texture size limit), with no mipmaps and linear filtering.
 * - Anchors: `anchorX`/`anchorY` place the text block (not its outline) the
 *   way troika does: left/center/right and top/middle/bottom of the block.
 * - `maxWidth` (world units) wraps at spaces; `\n` always breaks a line.
 * - Colours are baked into the texture, so the material stays white.
 * - Textures are shared through a cache keyed by the text and its style, and
 *   disposed a moment after the last label using one unmounts.
 */
import { useEffect, useMemo, type JSX, type ReactNode } from 'react';
import * as THREE from 'three/webgpu';

export interface LupiTextProps {
  children: string | number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /** World-space em height. */
  fontSize?: number;
  color?: THREE.ColorRepresentation;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  fontWeight?: 'normal' | 'bold';
  /** World units, or a percentage of fontSize (troika's string form, e.g. '8%'). */
  outlineWidth?: number | string;
  outlineColor?: THREE.ColorRepresentation;
  outlineOpacity?: number;
  maxWidth?: number;
  renderOrder?: number;
  depthTest?: boolean;
  depthWrite?: boolean;
  transparent?: boolean;
  opacity?: number;
}

/** Texture pixels per em at devicePixelRatio 1. */
export const LABEL_PX_PER_EM = 64;
/** Line advance in ems (close to troika's `lineHeight: 'normal'`). */
export const LABEL_LINE_HEIGHT = 1.2;
/** Largest canvas side; longer labels are rasterized at fewer pixels per em. */
const MAX_CANVAS_SIDE = 4096;
/** Transparent margin around the outline, in texture pixels. */
const EDGE_PADDING_PX = 2;
/** How long an unused texture stays cached before it is disposed. */
const RELEASE_DELAY_MS = 2000;
const FONT_FAMILY =
  "'IBM Plex Sans', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

interface LabelRasterSpec {
  text: string;
  bold: boolean;
  /** CSS colour strings (sRGB). */
  fill: string;
  outline: string;
  outlineOpacity: number;
  /** Outline width in ems (0 = none). */
  outlineEm: number;
  /** Wrap width in ems (Infinity = no wrap). */
  maxWidthEm: number;
  pxPerEm: number;
}

interface LabelRaster {
  texture: THREE.CanvasTexture;
  /** Plane size in ems (the whole canvas, padding included). */
  width: number;
  height: number;
  /** Text block size in ems (without outline or padding). */
  blockWidth: number;
  blockHeight: number;
}

interface LabelEntry extends LabelRaster {
  key: string;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const cache = new Map<string, LabelEntry>();
let measureContext: CanvasRenderingContext2D | null = null;

/** One unit plane shared by every label; each mesh scales it to its size. */
const UNIT_PLANE = new THREE.PlaneGeometry(1, 1);

function cssColor(value: THREE.ColorRepresentation | undefined, fallback: string): string {
  if (value === undefined || value === null) return fallback;
  return `#${new THREE.Color(value).getHexString()}`;
}

function outlineEmFor(width: number | string | undefined, fontSize: number): number {
  if (width === undefined || fontSize <= 0) return 0;
  if (typeof width === 'number') return Math.max(0, width / fontSize);
  const percent = /^\s*([\d.]+)\s*%\s*$/.exec(width);
  if (percent) return Number(percent[1]) / 100;
  const units = Number(width);
  return Number.isFinite(units) ? Math.max(0, units / fontSize) : 0;
}

function labelPixelRatio(): number {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return Math.min(Math.max(dpr, 1), 2);
}

function specKey(spec: LabelRasterSpec): string {
  return [
    spec.text,
    spec.bold ? 'b' : 'n',
    spec.fill,
    spec.outline,
    spec.outlineOpacity.toFixed(3),
    spec.outlineEm.toFixed(4),
    Number.isFinite(spec.maxWidthEm) ? spec.maxWidthEm.toFixed(3) : 'inf',
    spec.pxPerEm.toFixed(2),
  ].join('\u0000');
}

function fontFor(bold: boolean, px: number): string {
  return `${bold ? 700 : 400} ${px}px ${FONT_FAMILY}`;
}

/** Break `text` into lines no wider than `maxWidthPx` (at spaces; `\n` always breaks). */
function wrapLines(context: CanvasRenderingContext2D, text: string, maxWidthPx: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!Number.isFinite(maxWidthPx)) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && context.measureText(candidate).width > maxWidthPx) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

function layout(spec: LabelRasterSpec, px: number) {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const context = measureContext;
  if (!context) throw new Error('LupiText: no 2D canvas context');
  context.font = fontFor(spec.bold, px);
  const lines = wrapLines(context, spec.text, spec.maxWidthEm * px);
  const blockWidth = Math.max(1, ...lines.map((line) => context.measureText(line).width));
  const lineHeight = LABEL_LINE_HEIGHT * px;
  const blockHeight = lines.length * lineHeight;
  const pad = Math.ceil(spec.outlineEm * px + EDGE_PADDING_PX);
  return {
    lines,
    lineHeight,
    blockWidth,
    blockHeight,
    pad,
    width: Math.ceil(blockWidth + 2 * pad),
    height: Math.ceil(blockHeight + 2 * pad),
  };
}

function rasterizeLabel(spec: LabelRasterSpec): LabelRaster {
  let px = spec.pxPerEm;
  let box = layout(spec, px);
  const largest = Math.max(box.width, box.height);
  if (largest > MAX_CANVAS_SIDE) {
    px = Math.max(4, Math.floor((px * (MAX_CANVAS_SIDE - 8)) / largest));
    box = layout(spec, px);
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.min(box.width, MAX_CANVAS_SIDE);
  canvas.height = Math.min(box.height, MAX_CANVAS_SIDE);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('LupiText: no 2D canvas context');
  context.font = fontFor(spec.bold, px);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const lineY = (index: number) => box.pad + (index + 0.5) * box.lineHeight;

  const outlinePx = spec.outlineEm * px;
  if (outlinePx > 0 && spec.outlineOpacity > 0) {
    // The stroke straddles the glyph edge; the fill covers its inner half.
    context.lineJoin = 'round';
    context.miterLimit = 2;
    context.lineWidth = outlinePx * 2;
    context.strokeStyle = spec.outline;
    context.globalAlpha = Math.min(1, spec.outlineOpacity);
    box.lines.forEach((line, index) => context.strokeText(line, box.pad, lineY(index)));
    context.globalAlpha = 1;
  }
  context.fillStyle = spec.fill;
  box.lines.forEach((line, index) => context.fillText(line, box.pad, lineY(index)));

  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'LupiText';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;

  return {
    texture,
    width: canvas.width / px,
    height: canvas.height / px,
    blockWidth: box.blockWidth / px,
    blockHeight: box.blockHeight / px,
  };
}

function scheduleRelease(entry: LabelEntry): void {
  if (entry.timer !== null) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.refs > 0 || cache.get(entry.key) !== entry) return;
    cache.delete(entry.key);
    entry.texture.dispose();
  }, RELEASE_DELAY_MS);
}

/** The cached texture for a spec. An entry nobody retains is released after a delay. */
function labelEntry(spec: LabelRasterSpec, key: string): LabelEntry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { key, refs: 0, timer: null, ...rasterizeLabel(spec) };
    cache.set(key, entry);
    // Covers a render that never commits, so never retains it.
    scheduleRelease(entry);
  }
  return entry;
}

function retain(entry: LabelEntry): () => void {
  entry.refs += 1;
  if (entry.timer !== null) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  // An entry released before this commit (a long suspended render) rejoins the cache.
  if (!cache.has(entry.key)) cache.set(entry.key, entry);
  return () => {
    entry.refs -= 1;
    if (entry.refs <= 0) scheduleRelease(entry);
  };
}

/** Number of label textures currently cached. */
export function labelTextureCount(): number {
  return cache.size;
}

function anchorOffset(
  entry: LabelEntry,
  anchorX: NonNullable<LupiTextProps['anchorX']>,
  anchorY: NonNullable<LupiTextProps['anchorY']>,
): [number, number] {
  // The plane is centred on the text block (the padding is symmetric), so the
  // offset moves the block's anchor point onto the label origin.
  const x = anchorX === 'center' ? 0 : anchorX === 'right' ? -entry.blockWidth / 2 : entry.blockWidth / 2;
  const y = anchorY === 'middle' ? 0 : anchorY === 'bottom' ? entry.blockHeight / 2 : -entry.blockHeight / 2;
  return [x, y];
}

export function LupiText({
  children,
  position,
  rotation,
  fontSize = 0.1,
  color,
  anchorX = 'left',
  anchorY = 'top',
  fontWeight = 'normal',
  outlineWidth,
  outlineColor,
  outlineOpacity = 1,
  maxWidth,
  renderOrder = 0,
  depthTest = true,
  depthWrite = false,
  transparent = true,
  opacity = 1,
}: LupiTextProps): JSX.Element | null {
  const text = String(children);
  const drawable = typeof document !== 'undefined' && fontSize > 0 && text.trim().length > 0;
  const spec: LabelRasterSpec = {
    text,
    bold: fontWeight === 'bold',
    fill: cssColor(color, '#ffffff'),
    outline: cssColor(outlineColor, '#000000'),
    outlineOpacity: Math.max(0, outlineOpacity),
    outlineEm: outlineEmFor(outlineWidth, fontSize),
    maxWidthEm: maxWidth !== undefined && maxWidth > 0 && fontSize > 0 ? maxWidth / fontSize : Number.POSITIVE_INFINITY,
    pxPerEm: LABEL_PX_PER_EM * labelPixelRatio(),
  };
  const key = drawable ? specKey(spec) : '';
  // `key` encodes every field of `spec`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => (key ? labelEntry(spec, key) : null), [key]);

  useEffect(() => (entry ? retain(entry) : undefined), [entry]);

  const material = useMemo(() => {
    if (!entry) return null;
    const next = new THREE.MeshBasicNodeMaterial({
      map: entry.texture,
      transparent,
      opacity,
      depthTest,
      depthWrite,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    // Keeps the empty margin out of the depth buffer when depthWrite is on.
    next.alphaTest = 0.01;
    next.name = 'LupiText';
    return next;
  }, [entry, transparent, opacity, depthTest, depthWrite]);

  useEffect(() => () => material?.dispose(), [material]);

  if (!entry || !material) return null;
  const [offsetX, offsetY] = anchorOffset(entry, anchorX, anchorY);
  return (
    <group position={position} rotation={rotation}>
      <mesh
        name="lupi-text"
        geometry={UNIT_PLANE}
        material={material}
        renderOrder={renderOrder}
        position={[offsetX * fontSize, offsetY * fontSize, 0]}
        scale={[entry.width * fontSize, entry.height * fontSize, 1]}
        userData={{ lupiText: text }}
      />
    </group>
  );
}

/** Label textures live in a module cache, so this stays a pass-through. */
export function LupiTextProvider({ children }: { children: ReactNode }): JSX.Element {
  return <>{children}</>;
}
