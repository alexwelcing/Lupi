/**
 * illustrate.ts — turning the Illustrate look on and off from anywhere (the
 * Play tray's Ink, the palette, the `I` key), without touching the plate,
 * the light or the post recipe the visitor chose: Ink only swaps the
 * impostors' shading (`inkStyle`), and the post recipe steps aside while it
 * is on (postprocess/controls.ts `inkRecipe`).
 *
 * The last ink shading used (flat or hatched) is remembered for the tab, so
 * Ink brings back the drawing you had. The Looks grid (Illustrate, Sketch)
 * sets plate and shading together instead (sceneLooks.ts).
 */
import { sanitizeInkStyle, useStore, type InkStyle } from '../store';
import { playStore } from '../play/playStore';
import { BG_PRESETS, SAGE_PLATE_COLOR } from '../backgroundPresets';

const LAST_KEY = 'lupi.ink.last';

function readLast(): Exclude<InkStyle, 'off'> {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(LAST_KEY) === 'hatch' ? 'hatch' : 'flat';
  } catch {
    return 'flat';
  }
}

function writeLast(style: Exclude<InkStyle, 'off'>): void {
  try {
    sessionStorage.setItem(LAST_KEY, style);
  } catch {
    /* storage blocked: Ink falls back to flat colour */
  }
}

/**
 * A change made here (the Play tray, the palette, `I`) burns through the
 * molecule as a Light Fuse from the selected, hovered or centre-front atom
 * (ink/InkLookDriver.tsx). Changes from anywhere else (an agent's
 * `lupi.set_viewer`, the Looks grid, a link) crossfade as before.
 */
const FUSE_REQUEST_MS = 500;
let fuseRequestedAt = Number.NEGATIVE_INFINITY;

/** True once for a look change this module made in the last moment (the ink driver asks as the look changes). */
export function takeInkFuseRequest(now: number = performance.now()): boolean {
  const requested = now - fuseRequestedAt <= FUSE_REQUEST_MS;
  fuseRequestedAt = Number.NEGATIVE_INFINITY;
  return requested;
}

/** A short name for a shading, for the pill and announcements. */
export function inkStyleLabel(style: InkStyle): string {
  return style === 'hatch' ? 'Sketch' : style === 'flat' ? 'Illustrate' : 'Lit';
}

/**
 * Turn the drawing on (the last shading used) or off (back to the lit
 * surface). `flash` shows the change on the Play pill for a moment.
 */
export function setIllustrate(on: boolean, options: { flash?: boolean } = {}): void {
  const state = useStore.getState();
  const current = state.inkStyle;
  if (on === (current !== 'off')) return;
  fuseRequestedAt = performance.now();
  if (on) {
    // Refractive glass draws real spheres, which take no ink: the drawing
    // needs the impostors, so the finish goes back to the Looks' plastic.
    if (state.materialPreset === 'transmission') useStore.setState({ materialPreset: 'plastic' });
    state.setInkStyle(readLast());
  } else {
    if (current !== 'off') writeLast(current);
    state.setInkStyle('off');
  }
  if (options.flash) {
    const next = useStore.getState().inkStyle;
    playStore.getState().flashText(
      next === 'off' ? 'Lit · the light is on' : `${inkStyleLabel(next)} · ink look`,
      'info',
      1600,
    );
  }
}

export function toggleIllustrate(options: { flash?: boolean } = {}): void {
  setIllustrate(useStore.getState().inkStyle === 'off', options);
}

/** Choose a shading directly (the Ink controls); remembers it for Ink. */
export function chooseInkStyle(style: InkStyle): void {
  if (style !== 'off') {
    writeLast(style);
    if (useStore.getState().materialPreset === 'transmission') useStore.setState({ materialPreset: 'plastic' });
  }
  useStore.getState().setInkStyle(style);
}

/** The plate colour a background preset reads as (the even mix of its two stops): the ink depth cue fades toward it. */
export function inkPlateColor(backgroundPreset: string): string {
  const preset = BG_PRESETS[backgroundPreset];
  if (!preset) return SAGE_PLATE_COLOR;
  const parse = (hex: string) => {
    const value = /^#[0-9a-f]{6}$/i.test(hex) ? parseInt(hex.slice(1), 16) : 0x101817;
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  };
  const a = parse(preset.top);
  const b = parse(preset.bottom);
  const mixed = a.map((channel, i) => Math.round((channel + b[i]) / 2));
  return `#${((mixed[0] << 16) | (mixed[1] << 8) | mixed[2]).toString(16).padStart(6, '0')}`;
}

/**
 * The Illustrate look in a short link: `ink=f` (flat colour) or `ink=h`
 * (hatched). Instant Replay and Remix links carry it beside `replay=` and
 * `remix=`, which travel without the full `s=` state, so whoever opens them
 * sees the drawing the sender was looking at.
 */
export const INK_PARAM = 'ink';

/** The `ink=` value for a shading, or null when the look is lit. */
export function inkParamValue(style: InkStyle = useStore.getState().inkStyle): string | null {
  return style === 'flat' ? 'f' : style === 'hatch' ? 'h' : null;
}

/**
 * Take `?ink=` from the address bar as the viewer boots (idempotent). The
 * shading lands before the molecule opens, so it opens inked; the parameter
 * leaves the address bar, like `remix=`, so a reload keeps whatever look
 * the visitor moves on to. A `?s=` state decoded afterwards still wins.
 */
export function intakeInkParam(): boolean {
  if (typeof window === 'undefined') return false;
  let url: URL;
  try {
    url = new URL(window.location.href);
  } catch {
    return false;
  }
  const value = url.searchParams.get(INK_PARAM);
  if (value === null) return false;
  url.searchParams.delete(INK_PARAM);
  try {
    window.history.replaceState(window.history.state, '', url);
  } catch {
    /* sandboxed: the parameter stays, harmlessly */
  }
  const style = sanitizeInkStyle(value);
  if (style === 'off') return false;
  chooseInkStyle(style);
  return true;
}
