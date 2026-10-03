/**
 * AtomGlowDriver — feeds the atom impostor's glow (scene `tsl/atomGlow.ts`)
 * from the viewer's hover and selection, inside the Canvas.
 *
 * - Desktop hover: the atom under the cursor gets a soft lime rim and swells
 *   a touch; it fades in quickly and out a little slower. (Phones never
 *   hover; a tap selects.)
 * - Selection: up to four selected atoms get the stronger rim, fading in on
 *   every new selection.
 * - Tug's grabbed atom and Heat's warm tint are written by the PlayLayer.
 *
 * It only writes the shared glow uniforms; the capture and recording guards
 * in scene keep every artifact free of it. Under Motion: Still the fades cut.
 * Quiet Idle: it keeps the loop awake only while a fade runs.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/webgpu';
import { ATOM_GLOW, LUPI_JOB, LUPI_PHASE, keepLupiAwake, requestLupiFrames, resetLupiAtomGlow } from '@atlas/scene';
import { getComfort } from '../motion/comfort';

export interface AtomGlowDriverProps {
  hoveredAtom: number | null;
  selectedAtoms: readonly number[];
  /** False hides every glow (the transmission renderer has no impostor). */
  enabled: boolean;
}

/** Fade time constants (s). */
const HOVER_IN_S = 0.06;
const HOVER_OUT_S = 0.14;
const SELECT_IN_S = 0.12;
const SELECT_OUT_S = 0.16;
/** Below this the fade is done (and an outgoing index is dropped). */
const SETTLED = 0.002;
const MAX_STEP_S = 0.1;

interface Fade {
  level: number;
  target: number;
}

function approach(fade: Fade, dt: number, inS: number, outS: number): void {
  if (getComfort() === 'still') {
    fade.level = fade.target;
    return;
  }
  const tau = fade.target > fade.level ? inS : outS;
  fade.level += (fade.target - fade.level) * (1 - Math.exp(-dt / tau));
  if (Math.abs(fade.target - fade.level) < SETTLED) fade.level = fade.target;
}

export function AtomGlowDriver({ hoveredAtom, selectedAtoms, enabled }: AtomGlowDriverProps): null {
  const state = useRef({
    hover: { level: 0, target: 0 } as Fade,
    select: { level: 0, target: 0 } as Fade,
    lastWall: -1,
  });

  // Quiet Idle: draw while a fade runs.
  useEffect(
    () => keepLupiAwake('atom-glow', () => {
      const { hover, select } = state.current;
      return hover.level !== hover.target || select.level !== select.target;
    }),
    [],
  );
  useEffect(() => () => resetLupiAtomGlow(), []);

  // Hover: a new atom starts its fade from zero; leaving fades the old one out.
  useLayoutEffect(() => {
    const hover = state.current.hover;
    const next = enabled && hoveredAtom != null && hoveredAtom >= 0 ? hoveredAtom : -1;
    if (next >= 0) {
      if (ATOM_GLOW.uHoverAtom.value !== next) {
        ATOM_GLOW.uHoverAtom.value = next;
        hover.level = 0;
      }
      hover.target = 1;
    } else {
      hover.target = 0;
    }
    ATOM_GLOW.uHoverLevel.value = hover.level;
    requestLupiFrames();
  }, [hoveredAtom, enabled]);

  // Selection: the first four selected atoms; a changed selection fades in again.
  const selectionKey = enabled ? selectedAtoms.slice(0, 4).join(',') : '';
  useLayoutEffect(() => {
    const select = state.current.select;
    const ids = selectionKey ? selectionKey.split(',').map(Number) : [];
    if (ids.length > 0) {
      ATOM_GLOW.uSelectAtoms.value.set(ids[0] ?? -1, ids[1] ?? -1, ids[2] ?? -1, ids[3] ?? -1);
      select.level = 0;
      select.target = 1;
    } else {
      select.target = 0;
    }
    ATOM_GLOW.uSelectLevel.value = select.level;
    requestLupiFrames();
  }, [selectionKey]);

  useFrame(
    () => {
      const s = state.current;
      const wall = performance.now();
      const dt = s.lastWall < 0 ? 1 / 60 : Math.min(MAX_STEP_S, Math.max(0, (wall - s.lastWall) / 1000));
      const moving = s.hover.level !== s.hover.target || s.select.level !== s.select.target;
      // Forget the wall time at rest: the loop may sleep before the next fade.
      s.lastWall = moving ? wall : -1;
      if (!moving) return;
      approach(s.hover, dt, HOVER_IN_S, HOVER_OUT_S);
      approach(s.select, dt, SELECT_IN_S, SELECT_OUT_S);
      ATOM_GLOW.uHoverLevel.value = s.hover.level;
      ATOM_GLOW.uSelectLevel.value = s.select.level;
      if (s.hover.level === 0 && s.hover.target === 0) ATOM_GLOW.uHoverAtom.value = -1;
      if (s.select.level === 0 && s.select.target === 0) ATOM_GLOW.uSelectAtoms.value.set(-1, -1, -1, -1);
    },
    { phase: LUPI_PHASE.uniforms, id: LUPI_JOB.atomGlow },
  );

  return null;
}
