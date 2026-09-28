import { useMemo } from 'react';
import * as THREE from 'three';

// THREE.Clock is deprecated in three r183+ and fiber v10 has no state.clock;
// callers advance the Timer with `timer.update()` once per frame.
export function useGlobalTimer() {
  const timer = useMemo(() => new THREE.Timer(), []);
  return timer;
}
