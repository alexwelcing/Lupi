import { isSettled, springStep, type SpringState } from '../lib/spring';

const SPRING = { stiffness: 360, damping: 21, mass: 1 };
const rest = (): SpringState => ({ x: 0, v: 0 });
const clamp = (value: number, limit = 1) => Math.max(-limit, Math.min(limit, value));
const properties = ['--action-x', '--action-y', '--action-press'] as const;

/** Deform the painted surface, never the native button's layout or hit area.
 * No React renders, dependency/device acquisition, idle loop or input capture.
 */
export function attachActionMotion(node: HTMLButtonElement): () => void {
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const contrast = window.matchMedia?.('(forced-colors: active)');
  let frame = 0;
  let previous = 0;
  let lastInput = 0;
  let closed = false;
  let pointerId: number | undefined;
  let heldKey: string | undefined;
  let targetX = 0;
  let targetY = 0;
  let targetPress = 0;
  let x = rest();
  let y = rest();
  let press = rest();
  const allowed = () => !closed && !node.disabled && !document.hidden && !reduced?.matches && !contrast?.matches;
  const paint = () => {
    node.style.setProperty('--action-x', clamp(x.x).toFixed(4));
    node.style.setProperty('--action-y', clamp(y.x).toFixed(4));
    node.style.setProperty('--action-press', clamp(press.x, 1.15).toFixed(4));
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    pointerId = undefined;
    heldKey = undefined;
    targetX = targetY = targetPress = 0;
    x = rest(); y = rest(); press = rest();
    for (const property of properties) node.style.removeProperty(property);
    node.removeAttribute('data-action-moving');
    node.removeAttribute('data-action-pressed');
  };
  const tick = (now: number) => {
    frame = 0;
    if (!allowed() || !node.isConnected) { stop(); return; }
    // Integrate elapsed wall time in stable substeps. A busy 3D scene must not
    // turn a short spring into seconds of slow-motion by dropping RAF frames.
    const dt = Math.min(Math.max((now - previous) / 1000, 0), 1);
    const steps = Math.max(1, Math.ceil(dt * 120));
    previous = now;
    for (let step = 0; step < steps; step++) {
      x = springStep(x, targetX, SPRING, dt / steps);
      y = springStep(y, targetY, SPRING, dt / steps);
      press = springStep(press, targetPress, SPRING, dt / steps);
    }
    if (now - lastInput >= 1200 || (isSettled(x, targetX) && isSettled(y, targetY) && isSettled(press, targetPress))) {
      x = { x: targetX, v: 0 }; y = { x: targetY, v: 0 }; press = { x: targetPress, v: 0 };
      paint();
      node.removeAttribute('data-action-moving');
      return;
    }
    paint();
    frame = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!allowed()) { stop(); return; }
    lastInput = performance.now();
    if (frame) return;
    previous = lastInput;
    node.dataset.actionMoving = 'true';
    frame = requestAnimationFrame(tick);
  };
  const track = (event: PointerEvent) => {
    if (!allowed() || event.isPrimary === false) return;
    // Touch has no hover. Its implicit capture must not drag the decoration
    // around while the student is scrolling the sheet.
    if (event.pointerType === 'touch' && pointerId !== event.pointerId) return;
    const rect = node.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    targetX = clamp((event.clientX - rect.left) / rect.width * 2 - 1);
    targetY = clamp((event.clientY - rect.top) / rect.height * 2 - 1);
    wake();
  };
  const down = (event: PointerEvent) => {
    if (!allowed() || event.button !== 0 || event.isPrimary === false || pointerId !== undefined) return;
    pointerId = event.pointerId;
    targetPress = 1;
    // A small impulse makes even a quick tap visible before the next frame.
    press.v = 4;
    node.dataset.actionPressed = 'true';
    track(event);
    wake();
  };
  const release = () => {
    pointerId = undefined;
    heldKey = undefined;
    targetX = targetY = targetPress = 0;
    node.removeAttribute('data-action-pressed');
    wake();
  };
  const up = (event: PointerEvent) => { if (event.pointerId === pointerId) release(); };
  const keyDown = (event: KeyboardEvent) => {
    if (!allowed() || event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
    heldKey = event.key;
    targetX = targetY = 0;
    targetPress = 1;
    press.v = 4;
    node.dataset.actionPressed = 'true';
    wake();
  };
  const keyUp = (event: KeyboardEvent) => { if (event.key === heldKey) release(); };
  const preference = () => { if (!allowed()) stop(); };
  node.addEventListener('pointerenter', track);
  node.addEventListener('pointermove', track);
  node.addEventListener('pointerdown', down);
  node.addEventListener('pointerleave', release);
  node.addEventListener('pointercancel', stop);
  node.addEventListener('lostpointercapture', release);
  node.addEventListener('keydown', keyDown);
  node.addEventListener('keyup', keyUp);
  node.addEventListener('blur', stop);
  window.addEventListener('pointerup', up);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', preference);
  reduced?.addEventListener('change', preference);
  contrast?.addEventListener('change', preference);
  return () => {
    closed = true;
    stop();
    node.removeEventListener('pointerenter', track);
    node.removeEventListener('pointermove', track);
    node.removeEventListener('pointerdown', down);
    node.removeEventListener('pointerleave', release);
    node.removeEventListener('pointercancel', stop);
    node.removeEventListener('lostpointercapture', release);
    node.removeEventListener('keydown', keyDown);
    node.removeEventListener('keyup', keyUp);
    node.removeEventListener('blur', stop);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('blur', stop);
    document.removeEventListener('visibilitychange', preference);
    reduced?.removeEventListener('change', preference);
    contrast?.removeEventListener('change', preference);
  };
}
