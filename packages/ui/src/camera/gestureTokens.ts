/**
 * gestureTokens.ts — the numbers behind the viewer's gesture grammar.
 *
 * One place to tune how far a press may wander and still be a tap, how quick
 * a second tap must be, and how a release turns into a coast. The gesture
 * machine (gestureArbiter.ts) and the camera rig (rigController.ts) read
 * these; nothing else should hard-code them.
 */
import type { PointerKind } from '@atlas/scene';

export interface GestureTokens {
  /** Travel (CSS px) before a press becomes a drag, per pointer kind. */
  readonly slopPx: Readonly<Record<PointerKind, number>>;
  /** A second tap within this time and distance is a double tap. */
  readonly doubleTapMs: number;
  readonly doubleTapPx: number;
  /** Release velocity: least-squares slope over the samples in this window before release. */
  readonly flickWindowMs: number;
  /** A release this long after the last move is a held release (no coast). */
  readonly flickPauseMs: number;
  /** Below this apparent angular speed (rad/s) a release does not coast. */
  readonly flickMinRadPerSec: number;
  /** Release ω is clamped to this (rad/s): 3 rev/s. */
  readonly maxOmega: number;
  /** A right press released within this travel opens the Play tray. */
  readonly rightClickMaxPx: number;
  /** A released drag whose polar clamp engaged this recently drops its vertical ω. */
  readonly polarClampMemoryMs: number;
}

export const GESTURE: GestureTokens = {
  slopPx: { mouse: 3, touch: 8, pen: 8 },
  doubleTapMs: 300,
  doubleTapPx: 32,
  flickWindowMs: 80,
  flickPauseMs: 60,
  flickMinRadPerSec: 0.5,
  maxOmega: 6 * Math.PI,
  rightClickMaxPx: 3,
  polarClampMemoryMs: 80,
};
