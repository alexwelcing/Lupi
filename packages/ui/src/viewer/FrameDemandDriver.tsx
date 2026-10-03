/**
 * <FrameDemandDriver /> — Quiet Idle for the viewer canvas.
 *
 * The viewer canvas runs fiber's `demand` frameloop (`?frameloop=always`
 * restores continuous rendering). This component, mounted inside it:
 *
 * - runs the frame-demand driver in `finish` (LUPI_JOB.frameDemand): counts
 *   the drawn frame and invalidates the root while frames are owed, a settle
 *   window is open or a keeper is active (see `@atlas/scene` frameDemand);
 * - requests frames on every app-store write (camera, look, selection, hover,
 *   bonds, MCP, export requests…): fiber invalidates on its own only for
 *   React prop changes on three objects and for its root store;
 * - keeps the loop awake during trajectory playback (its rAF loop lives
 *   outside the canvas) and the flythrough preview;
 * - requests a frame on the first pointerdown, wheel or key (window capture
 *   phase, before any handler), when the tab becomes visible again, and on a
 *   resize or a device-pixel-ratio change, so the first touch renders at once;
 * - asks for frames on mount (entering demand grants none);
 * - installs `window.__lupiPlay` with the `frames` dev hook
 *   (`__lupiPlay.state().frames` and `.frameDemand`).
 */
import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber/webgpu';
import {
  LUPI_JOB,
  driveLupiFrameDemand,
  keepLupiAwake,
  lupiFrameStats,
  requestLupiFrames,
  stopLupiFrameDemand,
} from '@atlas/scene';
import { useStore } from '../store';
import { installPlayDevHooks, registerPlayDevHook } from '../play/devHooks';

export type ViewerFrameloop = 'always' | 'demand';

/**
 * The viewer's frameloop: `demand` (Quiet Idle), or `always` when the page
 * URL carries `?frameloop=always` (also inside a hash route such as
 * `#/mcp?frameloop=always`). Read once per mount.
 */
export function viewerFrameloop(
  search: string = typeof location === 'undefined' ? '' : location.search,
  hash: string = typeof location === 'undefined' ? '' : location.hash,
): ViewerFrameloop {
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?')) : '';
  const asked = new URLSearchParams(search).get('frameloop') ?? new URLSearchParams(hashQuery).get('frameloop');
  return asked === 'always' ? 'always' : 'demand';
}

export function FrameDemandDriver(): null {
  const get = useThree((state) => state.get);

  useFrame(
    (state) => {
      if (driveLupiFrameDemand()) state.invalidate();
    },
    { phase: 'finish', id: LUPI_JOB.frameDemand },
  );

  useEffect(() => {
    const wake = () => requestLupiFrames();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') wake();
    };
    let dprQuery: MediaQueryList | null = null;
    const onDprChange = () => {
      wake();
      watchDpr();
    };
    // A resolution query matches only the current ratio: re-arm on each change.
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDprChange);
      dprQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
        : null;
      dprQuery?.addEventListener('change', onDprChange);
    };
    watchDpr();
    const capture = { capture: true, passive: true } as const;
    window.addEventListener('pointerdown', wake, capture);
    window.addEventListener('wheel', wake, capture);
    window.addEventListener('keydown', wake, capture);
    window.addEventListener('resize', wake);
    document.addEventListener('visibilitychange', onVisibility);

    const offs = [
      // `__lupiPlay` (ref-counted with PlayLayer), so `frames` reads before a molecule opens.
      installPlayDevHooks(),
      // Any store write may change the scene; the settle window covers the
      // layout effects and post-commit effects that follow it.
      useStore.subscribe(wake),
      keepLupiAwake('playback', () => useStore.getState().playing),
      keepLupiAwake('flythrough', () => useStore.getState().flythroughPreview),
      registerPlayDevHook('frames', () => ({ ...lupiFrameStats(), frameloop: get().frameloop })),
    ];
    // Entering demand grants no frame: draw the first ones now.
    requestLupiFrames(3);
    return () => {
      for (const off of offs) off();
      window.removeEventListener('pointerdown', wake, capture);
      window.removeEventListener('wheel', wake, capture);
      window.removeEventListener('keydown', wake, capture);
      window.removeEventListener('resize', wake);
      document.removeEventListener('visibilitychange', onVisibility);
      dprQuery?.removeEventListener('change', onDprChange);
      stopLupiFrameDemand();
    };
  }, [get]);

  return null;
}
