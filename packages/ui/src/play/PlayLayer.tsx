/**
 * PlayLayer — the display-motion driver inside the Canvas (arrival, poke
 * ripple, scatter). WP0 stub: it only installs `window.__lupiPlay`.
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
