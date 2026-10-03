/**
 * lookMorph.ts — a Remix (or its Undo) morphs into the new look in about
 * 600 ms instead of snapping.
 *
 * The look is store state that many components turn into uniforms, so the
 * morph tweens the store itself, one write per animation frame (each write
 * also wakes the demand loop):
 *
 * - **Numbers** (light gains, elevations, surface offsets, material and post
 *   strength, shell size, backdrop motion speed) ease in-out.
 * - **Light angles** take the short way round.
 * - **Light colours** blend in linear light, not in sRGB.
 * - **Discrete choices** switch at the midpoint, under a dip where one
 *   exists: a new material preset dips the material strength (the atoms pass
 *   through their own element finish), a new post preset dips the effect
 *   strength (not to zero, which would rebuild the graph twice), and a shell
 *   that appears, goes or changes fades through clear. Palettes switch at
 *   the midpoint.
 * - **Backdrop.** Between two plain gradients the backdrop cross-fades on a
 *   dome (`RemixBackdropFade`) while the store already holds the new one;
 *   any other backdrop change switches at the midpoint.
 *
 * Motion comfort: Still cuts (the patch lands at once); Gentle and Standard
 * morph (it is a cross-fade of light and colour, not a moving object).
 *
 * Anyone else writing a key mid-morph (a slider, MCP, a saved view) takes
 * that key over: the morph stops touching it. The last frame writes the
 * exact target values, so a code still reads as current afterwards.
 */
import { Color } from 'three';
import type { ColormapName } from '@atlas/core/types';
import { useStore, type AppState } from '../store';
import { getComfort } from '../motion/comfort';
import { resolveBackground } from '../app/AppBackground';
import type { BackgroundGradientStyle } from '../equirectTexture';

export const LOOK_MORPH_MS = 600;

type LookPatch = Partial<AppState>;
type Key = keyof AppState & string;

const ANGLE_KEYS = new Set<string>(['keyLightAzimuth', 'fillLightAzimuth', 'rimLightAzimuth']);
const COLOR_KEYS = new Set<string>(['fillLightColor', 'rimLightColor']);
const NUMBER_KEYS = new Set<string>([
  'backgroundMotionSpeed', 'materialIntensity', 'surfaceRoughness', 'surfacePolish', 'surfaceClearcoat',
  'ambientLightIntensity', 'dirLightIntensity', 'rimLightIntensity',
  'keyLightElevation', 'fillLightElevation', 'rimLightElevation',
  'filterShellOpacity', 'filterShellRadius', 'postprocessIntensity',
]);
/** Keys that switch with the backdrop (all at once, at the midpoint or the start). */
const BACKDROP_KEYS = new Set<string>([
  'backgroundPreset', 'backgroundStyle', 'backgroundBackdropShape', 'backgroundBackdropPattern',
  'backgroundOpacity', 'backgroundBrightness', 'backgroundSaturation', 'backgroundContrast',
  'backgroundYawDegrees', 'backgroundPitchDegrees',
]);
/** Labels that carry no picture: written at the start. */
const LABEL_KEYS = new Set<string>(['materialScene']);

/** The material strength a preset change dips to at the midpoint. */
const MATERIAL_DIP = 0.06;
/** The post strength a preset change dips to (above 0: zero rebuilds the graph). */
const POST_DIP = 0.3;
/** A shell fading through clear stops just above zero (zero unmounts it). */
const SHELL_CLEAR = 0.001;

/** A plain-gradient cross-fade the dome draws: the old backdrop over the new. */
export interface BackdropFade {
  from: { top: string; bottom: string; style: BackgroundGradientStyle };
  to: { top: string; bottom: string; style: BackgroundGradientStyle };
}

export type LookMorphEvent =
  | { phase: 'start'; fade: BackdropFade | null; duration: number }
  | { phase: 'end' };

interface Channel {
  key: Key;
  kind: 'number' | 'angle' | 'color' | 'discrete' | 'materialDip' | 'postDip' | 'shellOpacity';
  from: unknown;
  to: unknown;
  /** Discrete keys: when the switch happens (0 start, 0.5 midpoint, 1 end). */
  at?: number;
  /** Colours in linear light. */
  fromColor?: Color;
  toColor?: Color;
  /** The shell opacity's path: start (`from`) → middle → end; `to` is the exact final value. */
  middle?: number;
  end?: number;
  done?: boolean;
}

interface Morph {
  channels: Channel[];
  start: number;
  duration: number;
  /** What this morph last wrote, per key (a different value means someone took over). */
  written: Map<string, unknown>;
  raf: number | null;
  onDone?: () => void;
}

let active: Morph | null = null;
const listeners = new Set<(event: LookMorphEvent) => void>();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function emit(event: LookMorphEvent): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch (error) {
      console.error('[lupi] look morph listener threw', error);
    }
  }
}

/** Listen for morph starts and ends (the backdrop fade, the softbox throttle). */
export function subscribeLookMorph(listener: (event: LookMorphEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True while a look morph runs. */
export function isLookMorphing(): boolean {
  return active !== null;
}

/** The running morph's eased progress 0..1 (1 when none runs). */
export function lookMorphProgress(): number {
  if (!active) return 1;
  return ease(Math.min(1, Math.max(0, (now() - active.start) / active.duration)));
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function shortAngle(from: number, to: number, t: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180;
  return Math.round((from + delta * t) * 100) / 100;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-9;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

function linearColor(hex: unknown): Color | null {
  if (typeof hex !== 'string') return null;
  try {
    // three's Color parses CSS colours to linear working space (ColorManagement).
    return new Color(hex);
  } catch {
    return null;
  }
}

type BackdropState = Pick<AppState,
  | 'backgroundPreset' | 'backgroundStyle' | 'backgroundBackdropShape' | 'backgroundBackdropPattern'
  | 'backgroundOpacity' | 'backgroundBrightness' | 'backgroundSaturation' | 'backgroundContrast'
  | 'backgroundYawDegrees' | 'backgroundPitchDegrees' | 'colormap'>;

/** A backdrop drawn as a plain gradient through `scene.background` (no mesh, no media). */
function plainGradient(state: BackdropState): { top: string; bottom: string; style: BackgroundGradientStyle } | null {
  if (state.backgroundBackdropShape !== 'dome' || state.backgroundBackdropPattern !== 'image') return null;
  if (state.backgroundOpacity !== 1 || state.backgroundBrightness !== 1 || state.backgroundSaturation !== 1
    || state.backgroundContrast !== 1 || state.backgroundYawDegrees !== 0 || state.backgroundPitchDegrees !== 0) return null;
  const resolved = resolveBackground(state.backgroundPreset, state.colormap as ColormapName);
  if (resolved.procedural || resolved.media.kind !== 'gradient') return null;
  return { top: resolved.top, bottom: resolved.bottom, style: state.backgroundStyle };
}

function stop(morph: Morph): void {
  if (morph.raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(morph.raf);
  morph.raf = null;
}

/** Cancel a running morph where it stands (its last written values stay). */
export function cancelLookMorph(): void {
  const morph = active;
  if (!morph) return;
  stop(morph);
  active = null;
  emit({ phase: 'end' });
}

/**
 * Morph the viewer's look to `patch`. Under Still (or without animation
 * frames) the patch lands at once. `onDone` runs after the last write.
 */
export function morphLook(patch: LookPatch, options: { duration?: number; onDone?: () => void } = {}): void {
  cancelLookMorph();
  const state = useStore.getState();
  const duration = options.duration ?? LOOK_MORPH_MS;
  if (getComfort() === 'still' || typeof requestAnimationFrame !== 'function' || duration <= 0) {
    useStore.setState(patch);
    options.onDone?.();
    return;
  }

  const target = patch as Record<string, unknown>;
  const current = state as unknown as Record<string, unknown>;
  const keys = Object.keys(target).filter((key) => !same(current[key], target[key])) as Key[];
  if (keys.length === 0) {
    options.onDone?.();
    return;
  }

  // The backdrop: a cross-fade between plain gradients, else one switch at the midpoint.
  const backdropChanges = keys.some((key) => BACKDROP_KEYS.has(key))
    || ('colormap' in target && String(state.backgroundPreset).startsWith('palette:'));
  const nextBackdrop = { ...state, ...patch } as BackdropState;
  const fromGradient = backdropChanges ? plainGradient(state) : null;
  const toGradient = backdropChanges ? plainGradient(nextBackdrop) : null;
  const fade: BackdropFade | null = fromGradient && toGradient ? { from: fromGradient, to: toGradient } : null;
  const backdropAt = fade ? 0 : 0.5;

  const presetChanges = 'materialPreset' in target && !same(state.materialPreset, target.materialPreset);
  const postChanges = 'postprocessPreset' in target && !same(state.postprocessPreset, target.postprocessPreset);
  const fromShape = state.filterShellShape;
  const toShape = (target.filterShellShape as AppState['filterShellShape'] | undefined) ?? fromShape;
  const shellPresetChanges = 'filterShellPreset' in target && !same(state.filterShellPreset, target.filterShellPreset);
  const shellOpacityTo = (target.filterShellOpacity as number | undefined) ?? state.filterShellOpacity;

  const channels: Channel[] = [];
  const add = (channel: Channel) => channels.push(channel);
  const shellInvolved = fromShape !== toShape || (fromShape !== 'off' && shellPresetChanges);

  for (const key of keys) {
    const from = current[key];
    const to = target[key];
    if (LABEL_KEYS.has(key)) add({ key, kind: 'discrete', from, to, at: 0 });
    else if (BACKDROP_KEYS.has(key)) add({ key, kind: 'discrete', from, to, at: backdropAt });
    else if (key === 'materialIntensity' && presetChanges) add({ key, kind: 'materialDip', from, to });
    else if (key === 'postprocessIntensity' && postChanges) add({ key, kind: 'postDip', from, to });
    else if (key === 'filterShellOpacity' && shellInvolved) {
      // Handled with the shape below.
    } else if (key === 'filterShellShape') {
      // off → on: the shape appears at once, clear; on → off: it goes at the end.
      add({ key, kind: 'discrete', from, to, at: fromShape === 'off' ? 0 : toShape === 'off' ? 1 : 0.5 });
    } else if (key === 'filterShellPreset') add({ key, kind: 'discrete', from, to, at: fromShape === 'off' ? 0 : 0.5 });
    else if (ANGLE_KEYS.has(key) && typeof from === 'number' && typeof to === 'number') add({ key, kind: 'angle', from, to });
    else if (COLOR_KEYS.has(key)) {
      const fromColor = linearColor(from);
      const toColor = linearColor(to);
      if (fromColor && toColor) add({ key, kind: 'color', from, to, fromColor, toColor });
      else add({ key, kind: 'discrete', from, to, at: 0.5 });
    } else if (NUMBER_KEYS.has(key) && typeof from === 'number' && typeof to === 'number') add({ key, kind: 'number', from, to });
    else add({ key, kind: 'discrete', from, to, at: 0.5 });
  }
  // The preset itself switches at the midpoint, under its dip.
  if (presetChanges && !keys.includes('materialIntensity')) {
    add({ key: 'materialIntensity', kind: 'materialDip', from: state.materialIntensity, to: state.materialIntensity });
  }
  if (postChanges && !keys.includes('postprocessIntensity')) {
    add({ key: 'postprocessIntensity', kind: 'postDip', from: state.postprocessIntensity, to: state.postprocessIntensity });
  }
  if (shellInvolved) {
    const start = fromShape === 'off' ? SHELL_CLEAR : state.filterShellOpacity;
    const end = toShape === 'off' ? SHELL_CLEAR : shellOpacityTo;
    const middle = fromShape !== 'off' && toShape !== 'off' ? SHELL_CLEAR : (start + end) / 2;
    // The final value is exact: the target opacity, even when the shell went off.
    add({ key: 'filterShellOpacity', kind: 'shellOpacity', from: start, to: shellOpacityTo, middle, end });
  }

  const morph: Morph = {
    channels,
    start: now(),
    duration,
    written: new Map(),
    raf: null,
    onDone: options.onDone,
  };
  active = morph;
  emit({ phase: 'start', fade, duration });
  step(morph);
}

function valueAt(channel: Channel, t: number, e: number): unknown {
  switch (channel.kind) {
    case 'number':
      return lerp(channel.from as number, channel.to as number, e);
    case 'angle':
      return shortAngle(channel.from as number, channel.to as number, e);
    case 'color': {
      const color = channel.fromColor!.clone().lerp(channel.toColor!, e);
      return `#${color.getHexString()}`;
    }
    case 'materialDip':
    case 'postDip': {
      const dip = channel.kind === 'materialDip' ? MATERIAL_DIP : POST_DIP;
      const from = channel.kind === 'postDip' ? Math.max(POST_DIP, channel.from as number) : (channel.from as number);
      const to = channel.kind === 'postDip' ? Math.max(POST_DIP, channel.to as number) : (channel.to as number);
      return t < 0.5 ? lerp(from, Math.min(dip, from), ease(t * 2)) : lerp(Math.min(dip, to), to, ease(t * 2 - 1));
    }
    case 'shellOpacity': {
      const end = channel.end ?? (channel.to as number);
      const middle = channel.middle ?? (((channel.from as number) + end) / 2);
      return t < 0.5 ? lerp(channel.from as number, middle, ease(t * 2)) : lerp(middle, end, ease(t * 2 - 1));
    }
    default:
      return t >= (channel.at ?? 0.5) ? channel.to : channel.from;
  }
}

function step(morph: Morph): void {
  if (active !== morph) return;
  const t = Math.min(1, (now() - morph.start) / morph.duration);
  const e = ease(t);
  const state = useStore.getState() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const channel of morph.channels) {
    if (channel.done) continue;
    // Someone else wrote this key since our last frame: it is theirs now.
    if (morph.written.has(channel.key) && !same(state[channel.key], morph.written.get(channel.key))) {
      channel.done = true;
      continue;
    }
    const value = t >= 1 ? channel.to : valueAt(channel, t, e);
    if (channel.kind === 'discrete' && t < 1 && t < (channel.at ?? 0.5) && !morph.written.has(channel.key)) continue;
    if (!same(state[channel.key], value)) patch[channel.key] = value;
    morph.written.set(channel.key, value);
  }
  if (Object.keys(patch).length > 0) useStore.setState(patch as Partial<AppState>);
  if (t >= 1) {
    active = null;
    morph.raf = null;
    emit({ phase: 'end' });
    morph.onDone?.();
    return;
  }
  morph.raf = requestAnimationFrame(() => step(morph));
}
