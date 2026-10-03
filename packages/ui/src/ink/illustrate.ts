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
import { useStore, type InkStyle } from '../store';
import { playStore } from '../play/playStore';

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
  if (on) {
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
  if (style !== 'off') writeLast(style);
  useStore.getState().setInkStyle(style);
}
