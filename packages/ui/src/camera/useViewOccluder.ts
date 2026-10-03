/**
 * useViewOccluder — a phone overlay declares the screen area it covers, so
 * the live view moves the molecule into the room it leaves (viewInset.ts).
 *
 * Attach `ref` to the overlay's outer element. While `enabled`, the hook
 * re-declares the element's resting client rectangle (its layout box, so an
 * entrance animation declares where it will land) whenever it changes size,
 * ends a transition or animation, or the window resizes, and withdraws it
 * when the overlay goes or `enabled` turns false. A dragged sheet calls
 * `setTracking(true)` for the length of the drag, so the molecule rides it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { setViewOccluder, type ScreenRect } from './viewInset';

/**
 * The element's layout box in client px, without its transforms: where it
 * rests, not where an entrance animation has it this frame. Falls back to the
 * transformed box for an element with no offset parent.
 */
function restingRect(element: HTMLElement): ScreenRect {
  const parent = element.offsetParent as HTMLElement | null;
  if (!parent) {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }
  const box = parent.getBoundingClientRect();
  const left = box.left + parent.clientLeft + element.offsetLeft - parent.scrollLeft;
  const top = box.top + parent.clientTop + element.offsetTop - parent.scrollTop;
  return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
}

export interface ViewOccluderHandle {
  ref(node: HTMLElement | null): void;
  /** Re-measure now. */
  report(): void;
  /** The visitor started (true) or stopped (false) dragging the overlay. */
  setTracking(tracking: boolean): void;
}

export function useViewOccluder(
  id: string,
  enabled: boolean,
  options: { tapBorn?: boolean } = {},
): ViewOccluderHandle {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const tracking = useRef(false);
  const tapBorn = Boolean(options.tapBorn);
  const live = useRef({ node, enabled, id, tapBorn });
  live.current = { node, enabled, id, tapBorn };

  const report = useCallback(() => {
    const { node: element, enabled: on, id: key, tapBorn: born } = live.current;
    if (!element || !on || !element.isConnected) {
      setViewOccluder(key, null);
      return;
    }
    setViewOccluder(key, {
      rect: restingRect(element),
      tracking: tracking.current,
      tapBorn: born,
    });
  }, []);

  const setTracking = useCallback(
    (value: boolean) => {
      tracking.current = value;
      report();
    },
    [report],
  );

  useEffect(() => {
    if (!node || !enabled) {
      setViewOccluder(id, null);
      return undefined;
    }
    report();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => report()) : null;
    observer?.observe(node);
    node.addEventListener('transitionend', report);
    node.addEventListener('animationend', report);
    window.addEventListener('resize', report);
    return () => {
      observer?.disconnect();
      node.removeEventListener('transitionend', report);
      node.removeEventListener('animationend', report);
      window.removeEventListener('resize', report);
      tracking.current = false;
      setViewOccluder(id, null);
    };
  }, [node, enabled, id, report]);

  return { ref: setNode, report, setTracking };
}
