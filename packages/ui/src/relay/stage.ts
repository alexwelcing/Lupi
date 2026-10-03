/**
 * stage.ts — the no-splash relay: a sage layer outside #root that covers the
 * page from the tap until the viewer's first frame, so a visitor never sees a
 * dark splash or the page swapping underneath.
 *
 * - A hero tap swells the ink C60 from its spot on the home page to the size
 *   the viewer will fit it at (FLIP, MOTION.glide-shaped), and it stays
 *   spinnable while the viewer downloads; every turn is mirrored into the
 *   baton, so the 3D cage takes over at the pose the visitor left and keeps a
 *   live spin going (FirstFrameSignal).
 * - Tiles and finder rows grow their flat preview into the same sage stage.
 *   An ink tile grows its own ink drawing instead, to the size the viewer
 *   will draw the molecule at, from the pose the viewer opens on; the 3D view
 *   then opens in ink and the light comes on (ink/InkLookDriver.tsx).
 * - At 1.2 s a hairline lime ring traces the stage; at 10 s the stage says it
 *   is still loading and offers Retry (a plain deep link).
 * - end(): pointer-events off at once, a 120 ms fade, then the layer is gone.
 *   It also ends on FIRST_FRAME_EVENT, Back, the renderer's fallback screen,
 *   and is removed outright on pagehide.
 *
 * The layer lives on document.body, so it survives `root.render` of the
 * viewer. Registered with the baton's relay registry at module load; the
 * landing chunk imports it through MoleculeFinder, so it never pulls three.
 */
import { ELEMENT_DATA } from '@atlas/core';
import { MOTION, stepResponse } from '@atlas/core/motion';
import { DEFAULT_CAMERA_FIT_PADDING } from '../cameraFit';
import { useStore } from '../store';
import { glidesAnimate } from '../motion/comfort';
import { buckyStageSizeFor, createBuckyStage, type BuckyStage } from '../landing/hero/buckyStage';
import { C60_HERO } from '../landing/hero/c60Hero.data';
import { registerRelayImpl, setBaton, type RelayBaton } from './baton';
import { FIRST_FRAME_EVENT } from './firstFrame';
import { previewUrl } from './preview';
import { inkTileFor, inkTileSrc, type InkTile } from '../landing/inkTiles';
import './relay.css';

const HERO_ID = 'c60_buckyball';
const FLIP_MS = 280;
const BACKDROP_MS = 180;
const RING_AT_MS = 1_200;
const WAIT_AT_MS = 10_000;
const END_FADE_MS = 120;
const FACE_FLASH_MS = 1_400;
const WATCH_MS = 500;
/** The learn previews are 400 × 270. */
const PREVIEW_ASPECT = 270 / 400;
const PREVIEW_MAX_PX = 480;
const PREVIEW_VW = 0.86;
/** Height kept free around the preview for the ring and its copy (a landscape phone): relay.css's 150px. */
const PREVIEW_ROOM_PX = 150;
/** The traced ring sits just outside the drawn ball (which fills 84 % of its box). */
const HERO_RING = 0.94;
const PLATE_RING_PX = 22;
const FALLBACK_SELECTOR = '[data-testid="renderer-fallback"]';

/** The ink drawings' viewBox share the molecule's widest turn fills (moleculePage/ink.ts INK_VIEW, FILL). */
const INK_DRAWING_FILL = 0.88;
/** The ink drawing never grows past this share of the window's short side. */
const INK_MAX_SHARE = 0.96;

/** C60's bounds half-diagonal (Å): the viewer's fit sphere before the atom radius and padding. */
const C60_HALF_DIAGONAL = (() => {
  const p = C60_HERO.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  return Math.hypot((max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2);
})();

/**
 * How the viewer will frame C60 on a `width` × `height` canvas
 * (store.fitCameraView → cameraFit.ts: the same content radius, padding,
 * field of view and aspect rule): the camera distance (Å) and the screen
 * pixels per Å at the centre plane. The drawing is sized and put in
 * perspective from it, so it hands over at the cage's size and shape.
 */
function c60ViewerFit(width: number, height: number): { distance: number; pxPerAngstrom: number } {
  return viewerFitFor(width, height, C60_HALF_DIAGONAL + (ELEMENT_DATA[6]?.displayRadius ?? 0.38));
}

/** The same fit for any molecule, from its content radius before padding (Å). */
function viewerFitFor(width: number, height: number, contentRadius: number): { distance: number; pxPerAngstrom: number } {
  const fov = useStore.getState().cameraFov;
  const vertical = ((Number.isFinite(fov) && fov > 0 ? fov : 50) * Math.PI) / 360;
  const horizontal = Math.atan(Math.tan(vertical) * (width / height));
  const limiting = Math.min(vertical, horizontal);
  const limitingPx = (horizontal < vertical ? width : height) / 2;
  const padded = Math.max(1e-3, contentRadius) * DEFAULT_CAMERA_FIT_PADDING;
  const distance = padded / Math.sin(limiting);
  return { distance, pxPerAngstrom: limitingPx / (distance * Math.tan(limiting)) };
}

/** MOTION.glide's step response normalised to reach 1 at FLIP_MS: the FLIP's shape. */
function glideProgress(ms: number): number {
  if (ms >= FLIP_MS) return 1;
  return stepResponse(MOTION.glide, Math.max(0, ms) / 1000) / stepResponse(MOTION.glide, FLIP_MS / 1000);
}

/** A `linear()` easing sampled from MOTION.glide's step response over FLIP_MS (or a close cubic). */
const GLIDE_EASING = (() => {
  const points: string[] = [];
  for (let i = 0; i <= 16; i += 1) points.push(glideProgress((i / 16) * FLIP_MS).toFixed(4));
  const linear = `linear(${points.join(', ')})`;
  try {
    if (typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', linear)) return linear;
  } catch {
    /* fall through */
  }
  return 'cubic-bezier(0.2, 0.8, 0.2, 1)';
})();

interface Relay {
  baton: RelayBaton;
  hero: boolean;
  /** An ink tile's drawing and hand-off data (null for a flat preview). */
  inkSrc: string | null;
  inkTile: InkTile | null;
  layer: HTMLDivElement;
  backdrop: HTMLDivElement;
  stageEl: HTMLDivElement;
  ring: SVGSVGElement | HTMLSpanElement;
  face: HTMLParagraphElement;
  wait: HTMLDivElement;
  stage: BuckyStage | null;
  /** The viewer's fitted camera distance (Å) the hero drawing is put in perspective from. */
  distance: number;
  /** The drawing is still easing from the hero's orthographic view into that perspective. */
  easing: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
  cleanup: Array<() => void>;
}

let current: Relay | null = null;
let fading: Relay | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function circles(svg: SVGSVGElement, center: number, r: number, parts: string[]): void {
  for (const part of parts) {
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('class', part);
    circle.setAttribute('cx', String(center));
    circle.setAttribute('cy', String(center));
    circle.setAttribute('r', String(r));
    circle.setAttribute('pathLength', '100');
    svg.appendChild(circle);
  }
}

/** The hero's ring: a hairline that traces round the ball, then one arc keeps travelling. */
function heroRing(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lupi-relay__ring');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  circles(svg, 50, 49, ['lupi-relay__trace', 'lupi-relay__runner']);
  return svg;
}

/** A preview's ring: the plates' lime mark (RelayPlate's RelayRing), in the same place under the preview. */
function plateRing(): HTMLSpanElement {
  const mark = el('span', 'lupi-relay__mark');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'lupi-ring');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  circles(svg, 12, 10, ['lupi-ring__track', 'lupi-ring__arc']);
  mark.appendChild(svg);
  return mark;
}

function place(node: HTMLElement | SVGElement, left: number, top: number, width?: number, height?: number): void {
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
  if (width !== undefined) node.style.width = `${width}px`;
  if (height !== undefined) node.style.height = `${height}px`;
}

/** Where everything sits for the current window. The viewer's canvas fills the window, so the stage is centred on it. */
function layout(relay: Relay): void {
  const width = window.innerWidth || document.documentElement.clientWidth || 1;
  const height = window.innerHeight || document.documentElement.clientHeight || 1;
  const cx = width / 2;
  const cy = height / 2;
  let below: number;
  if (relay.hero) {
    const fit = c60ViewerFit(width, height);
    const size = buckyStageSizeFor(fit.pxPerAngstrom);
    relay.distance = fit.distance;
    if (relay.stage && !relay.easing) relay.stage.setPerspective(fit.distance);
    place(relay.stageEl, cx - size / 2, cy - size / 2, size, size);
    const ring = size * HERO_RING;
    place(relay.ring, cx - ring / 2, cy - ring / 2, ring, ring);
    // One CSS pixel in the ring's 100-unit viewBox.
    relay.ring.style.setProperty('--lupi-relay-hairline', (100 / Math.max(1, ring)).toFixed(4));
    below = cy + ring / 2;
  } else if (relay.inkSrc) {
    // The drawing at the size the viewer will fit the molecule (its widest
    // turn fills 88 % of the square), or a plate-sized square before the
    // manifest has said.
    const short = Math.min(width, height);
    const tile = relay.inkTile;
    const size = tile
      ? Math.min(short * INK_MAX_SHARE, (viewerFitFor(width, height, tile.fit).pxPerAngstrom * tile.inkRadius) / INK_DRAWING_FILL * 2)
      : Math.min(short * 0.8, PREVIEW_MAX_PX);
    place(relay.stageEl, cx - size / 2, cy - size / 2, size, size);
    const foot = Math.min(cy + (size * INK_DRAWING_FILL) / 2 + 14, height - PLATE_RING_PX - 40);
    place(relay.ring, cx - PLATE_RING_PX / 2, foot, PLATE_RING_PX, PLATE_RING_PX);
    below = foot + PLATE_RING_PX;
  } else {
    const w = Math.max(0, Math.min(width * PREVIEW_VW, PREVIEW_MAX_PX, (height - PREVIEW_ROOM_PX) / PREVIEW_ASPECT));
    const h = w * PREVIEW_ASPECT;
    place(relay.stageEl, cx - w / 2, cy - h / 2, w, h);
    place(relay.ring, cx - PLATE_RING_PX / 2, cy + h / 2 + 18, PLATE_RING_PX, PLATE_RING_PX);
    below = cy + h / 2 + 18 + PLATE_RING_PX;
  }
  relay.face.style.top = `${below + 10}px`;
  // Retry stays on screen, over the drawing's foot if the window is short.
  relay.wait.style.top = `${Math.max(0, Math.min(below + 40, height - relay.wait.offsetHeight - 16))}px`;
}

/**
 * FLIP: start over `from` (the tapped drawing or tile image) and glide into
 * place. Without a rect to grow from (a library card), the stage fades in
 * over the same time instead of popping over the page.
 */
function flip(relay: Relay, from: DOMRect | null): void {
  const to = relay.stageEl.getBoundingClientRect();
  if (!from || !(to.width > 0) || !(from.width > 0)) {
    try {
      relay.layer.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BACKDROP_MS, easing: 'ease-out' });
    } catch {
      /* no Web Animations: the stage simply appears */
    }
    return;
  }
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const scale = from.width / to.width;
  try {
    relay.stageEl.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${scale})` }, { transform: 'none' }],
      { duration: FLIP_MS, easing: GLIDE_EASING },
    );
    relay.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: BACKDROP_MS, easing: 'ease-out' });
  } catch {
    /* no Web Animations: the stage simply appears in place */
  }
}

function poseFromViewDir(viewDir: RelayBaton['viewDir']) {
  if (!viewDir) return undefined;
  const [x, y, z] = viewDir;
  const length = Math.hypot(x, y, z);
  if (!(length > 1e-6)) return undefined;
  return { azimuth: Math.atan2(x, z), elevation: Math.asin(Math.max(-1, Math.min(1, y / length))) };
}

function mountHero(relay: Relay): void {
  const { stageEl, baton } = relay;
  stageEl.dataset.kind = 'hero';
  stageEl.setAttribute('role', 'img');
  stageEl.setAttribute('aria-label', 'Buckyball, C60, opening in 3D. Drag to turn it while it loads.');
  let faceTimer: ReturnType<typeof setTimeout> | null = null;
  relay.cleanup.push(() => {
    if (faceTimer) clearTimeout(faceTimer);
  });
  const stage = createBuckyStage(stageEl, {
    size: stageEl.getBoundingClientRect().width || 300,
    pose: poseFromViewDir(baton.viewDir),
    interactive: true,
    onTap() {
      /* already opening */
    },
    onDetent(label) {
      relay.face.textContent = label;
      relay.face.dataset.on = '';
      if (faceTimer) clearTimeout(faceTimer);
      faceTimer = setTimeout(() => delete relay.face.dataset.on, FACE_FLASH_MS);
    },
    onSpinDegrees() {
      delete relay.face.dataset.on;
    },
    onPoseChange() {
      // Mirror every turn into the baton: the viewer takes over at this pose, with this spin.
      if (!relay.stage || current !== relay) return;
      setBaton({
        ...relay.baton,
        viewDir: relay.stage.viewDir(),
        bodyOmegaY: relay.stage.getBodyOmegaY(),
        t: performance.now(),
      });
    },
  });
  relay.stage = stage;
  easeIntoPerspective(relay);
  // Nothing under the relay scrolls: every swipe on the ball turns it.
  stageEl.style.touchAction = 'none';
  if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('bucky-hero__stage')) {
    // A keyboard open: keep the arrow keys turning the ball.
    stageEl.tabIndex = -1;
    stageEl.focus({ preventScroll: true });
  }
}

/**
 * The home page draws the ball orthographically; the viewer sees it from a
 * camera a few radii away. While the drawing swells into place (FLIP_MS, the
 * same glide), the perspective eases in, so at the hand-off the drawing and
 * the lit cage share their shape as well as their pose and size.
 */
function easeIntoPerspective(relay: Relay): void {
  const stage = relay.stage;
  if (!stage) return;
  if (relay.layer.dataset.still !== undefined) {
    stage.setPerspective(relay.distance);
    return;
  }
  relay.easing = true;
  const started = performance.now();
  let frame = 0;
  const step = () => {
    frame = 0;
    if (current !== relay || !relay.stage) return;
    const progress = glideProgress(performance.now() - started);
    // Ease 1/distance from 0 (orthographic) to the viewer's.
    relay.stage.setPerspective(progress >= 1 ? relay.distance : progress > 1e-3 ? relay.distance / progress : null);
    if (progress >= 1) relay.easing = false;
    else frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  relay.cleanup.push(() => {
    if (frame) cancelAnimationFrame(frame);
  });
}

function mountPreview(relay: Relay): void {
  if (relay.inkSrc) {
    // An ink tile: its drawing, lit, carried into the stage.
    relay.stageEl.dataset.kind = 'ink';
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = relay.inkSrc;
    img.addEventListener('error', () => img.remove(), { once: true });
    relay.stageEl.appendChild(img);
    return;
  }
  relay.stageEl.dataset.kind = 'preview';
  const src = previewUrl(relay.baton.galleryId);
  if (!src) return;
  const img = document.createElement('img');
  img.alt = '';
  img.decoding = 'async';
  img.src = src;
  img.addEventListener('error', () => img.remove(), { once: true });
  relay.stageEl.appendChild(img);
}

function showWait(relay: Relay): void {
  if (current !== relay || relay.wait.dataset.on !== undefined) return;
  relay.wait.dataset.on = '';
  relay.wait.querySelector('button')?.removeAttribute('tabindex');
}

function teardown(relay: Relay): void {
  for (const timer of relay.timers) clearTimeout(timer);
  relay.timers.length = 0;
  for (const undo of relay.cleanup.splice(0)) undo();
}

function removeNow(relay: Relay | null): void {
  if (!relay) return;
  teardown(relay);
  relay.stage?.destroy();
  relay.stage = null;
  relay.layer.remove();
  if (current === relay) current = null;
  if (fading === relay) fading = null;
}

function begin({ baton, fromRect }: { baton: RelayBaton; fromRect: DOMRect | null }): void {
  if (typeof document === 'undefined' || !document.body) return;
  removeNow(current);
  removeNow(fading);
  const still = !glidesAnimate();
  const hero = baton.source === 'hero' && baton.galleryId === HERO_ID;
  const inkSrc = !hero && baton.ink ? inkTileSrc(baton.galleryId) : null;

  const layer = el('div', 'lupi-relay');
  layer.setAttribute('data-lupi-relay', '');
  layer.setAttribute('role', 'status');
  layer.setAttribute('aria-label', 'Opening molecule');
  layer.dataset.source = baton.source;
  if (still) layer.dataset.still = '';
  const backdrop = el('div', 'lupi-relay__backdrop');
  const stageEl = el('div', 'lupi-relay__stage');
  const ring = hero ? heroRing() : plateRing();
  const face = el('p', 'lupi-relay__face');
  face.setAttribute('aria-hidden', 'true');
  const wait = el('div', 'lupi-relay__wait');
  const copy = el('p', '');
  copy.textContent = hero ? 'Still loading the 3D view — keep turning it' : 'Still loading the 3D view…';
  const retry = el('button', 'lupi-relay__retry');
  retry.type = 'button';
  retry.textContent = 'Retry';
  retry.tabIndex = -1;
  retry.addEventListener('click', () => {
    window.location.assign(`/?sim=${encodeURIComponent(baton.galleryId)}`);
  });
  wait.append(copy, retry);
  layer.append(backdrop, stageEl, ring, face, wait);

  const relay: Relay = {
    baton,
    hero,
    inkSrc,
    inkTile: inkSrc ? inkTileFor(baton.galleryId) : null,
    layer,
    backdrop,
    stageEl,
    ring,
    face,
    wait,
    stage: null,
    distance: 0,
    easing: false,
    timers: [],
    cleanup: [],
  };
  current = relay;
  document.body.appendChild(layer);
  layout(relay);
  if (hero) mountHero(relay);
  else mountPreview(relay);
  if (!still) flip(relay, fromRect);

  relay.timers.push(setTimeout(() => relay.ring.setAttribute('data-on', ''), RING_AT_MS));
  relay.timers.push(setTimeout(() => showWait(relay), WAIT_AT_MS));
  const watch = setInterval(() => {
    if (current !== relay) return;
    // Removed by someone else (main.tsx on an import failure), or the viewer cannot render at all.
    if (!layer.isConnected) removeNow(relay);
    else if (document.querySelector(FALLBACK_SELECTOR)) end();
  }, WATCH_MS);
  relay.cleanup.push(() => clearInterval(watch));

  const onFirstFrame = () => end();
  const onPageHide = () => removeNow(relay);
  const onPopState = () => end();
  const onResize = () => layout(relay);
  window.addEventListener(FIRST_FRAME_EVENT, onFirstFrame);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('resize', onResize);
  relay.cleanup.push(() => {
    window.removeEventListener(FIRST_FRAME_EVENT, onFirstFrame);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('popstate', onPopState);
    window.removeEventListener('resize', onResize);
  });
}

/** Hand over: no more input at once, a 120 ms fade, then the layer is gone. */
function end(): void {
  const relay = current;
  if (!relay) return;
  current = null;
  teardown(relay);
  relay.layer.dataset.ending = '';
  relay.layer.style.pointerEvents = 'none';
  relay.layer.setAttribute('aria-hidden', 'true');
  removeNow(fading);
  fading = relay;
  const timer = setTimeout(() => removeNow(relay), END_FADE_MS + 30);
  relay.cleanup.push(() => clearTimeout(timer));
}

function isActive(): boolean {
  return current !== null && current.layer.isConnected;
}

registerRelayImpl({ begin, end, isActive });
