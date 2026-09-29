/**
 * touchMarks.ts — a lime ring under each finger on the viewer canvas.
 *
 * One `<svg>` (pointer-events: none) laid over R3F's connected element. Each
 * touch or pen contact gets a 28 px ring that follows it and fades over
 * 200 ms after the finger lifts. A catch draws a ring that collapses into
 * the point. Under the Still comfort level nothing animates: rings appear
 * and disappear.
 *
 * Pure DOM decoration. It never receives events and is not part of any
 * capture (captures render the scene, not the page).
 */
const SVG_NS = 'http://www.w3.org/2000/svg';
const LIME = '#d5ef9c';
const RADIUS = 14;
const FADE_MS = 200;
const CATCH_MS = 260;

export interface TouchMarks {
  down(id: number, clientX: number, clientY: number): void;
  move(id: number, clientX: number, clientY: number): void;
  up(id: number): void;
  catchAt(clientX: number, clientY: number): void;
  clear(): void;
  dispose(): void;
}

export function createTouchMarks(host: HTMLElement, { still }: { still(): boolean }): TouchMarks {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('data-lupi-touch-marks', '');
  Object.assign(svg.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    overflow: 'visible',
    zIndex: '4',
  } satisfies Partial<CSSStyleDeclaration>);
  host.appendChild(svg);

  const rings = new Map<number, SVGCircleElement>();
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const local = (clientX: number, clientY: number): [number, number] => {
    const rect = host.getBoundingClientRect();
    return [clientX - rect.left, clientY - rect.top];
  };

  const circle = (x: number, y: number, r: number): SVGCircleElement => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', String(x));
    c.setAttribute('cy', String(y));
    c.setAttribute('r', String(r));
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke', LIME);
    c.setAttribute('stroke-width', '1.5');
    svg.appendChild(c);
    return c;
  };

  const later = (ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
  };

  return {
    down(id, clientX, clientY) {
      const [x, y] = local(clientX, clientY);
      rings.get(id)?.remove();
      rings.set(id, circle(x, y, RADIUS));
    },
    move(id, clientX, clientY) {
      const ring = rings.get(id);
      if (!ring) return;
      const [x, y] = local(clientX, clientY);
      ring.setAttribute('cx', String(x));
      ring.setAttribute('cy', String(y));
    },
    up(id) {
      const ring = rings.get(id);
      if (!ring) return;
      rings.delete(id);
      if (still()) {
        ring.remove();
        return;
      }
      ring.style.transition = `opacity ${FADE_MS}ms ease-out`;
      // Commit the start state, then fade.
      void ring.getBoundingClientRect();
      ring.style.opacity = '0';
      later(FADE_MS + 20, () => ring.remove());
    },
    catchAt(clientX, clientY) {
      if (still()) return;
      const [x, y] = local(clientX, clientY);
      const ring = circle(x, y, RADIUS * 1.8);
      ring.style.transformBox = 'fill-box';
      ring.style.transformOrigin = 'center';
      ring.style.transition = `transform ${CATCH_MS}ms cubic-bezier(0.3, 0, 0.2, 1), opacity ${CATCH_MS}ms ease-in`;
      void ring.getBoundingClientRect();
      ring.style.transform = 'scale(0.15)';
      ring.style.opacity = '0';
      later(CATCH_MS + 20, () => ring.remove());
    },
    clear() {
      for (const ring of rings.values()) ring.remove();
      rings.clear();
    },
    dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      rings.clear();
      svg.remove();
    },
  };
}
