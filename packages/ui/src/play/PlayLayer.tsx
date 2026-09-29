/**
 * PlayLayer — the display-motion driver inside the Canvas (arrival, poke
 * ripple, scatter). WP0 stub: it only installs `window.__lupiPlay`.
 *
 * Whoever replaces this body keeps the `installPlayDevHooks()` effect: it is
 * the only place `window.__lupiPlay` is installed, and every chain's smoke
 * plugins read it.
 */
import { useEffect } from 'react';
import type { Frame } from '@atlas/core/types';
import type { Vec3 } from '../camera/rigApi';
import { installPlayDevHooks } from './devHooks';

export interface PlayLayerProps {
  frame: Frame;
  center: Vec3;
  transmissionActive: boolean;
  playing: boolean;
}

export function PlayLayer(props: PlayLayerProps): null {
  void props;
  useEffect(() => installPlayDevHooks(), []);
  return null;
}
