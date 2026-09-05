import { forwardRef, useEffect, useImperativeHandle, useRef, type ButtonHTMLAttributes } from 'react';
import type { ActionLight } from './action-light/runtime';
import './action-light/action-light.css';

type Props = ButtonHTMLAttributes<HTMLButtonElement>;

/** Native actions first; a lazy, decorative GPU surface never owns input. */
export const LupiActionButton = forwardRef<HTMLButtonElement, Props>(function LupiActionButton(
  { children, className = '', disabled, type = 'button', ...props }, forwardedRef,
) {
  const button = useRef<HTMLButtonElement>(null);
  const lightHost = useRef<HTMLSpanElement>(null);
  useImperativeHandle(forwardedRef, () => button.current!, []);
  useEffect(() => {
    const node = button.current;
    const host = lightHost.current;
    if (!node || !host || disabled) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const contrast = window.matchMedia?.('(forced-colors: active)');
    let closed = false;
    let blocked = false;
    let generation = 0;
    let loading = false;
    let light: ActionLight | undefined;
    let animation = 0;
    let started = 0;
    let lastActivity = 0;
    let x = 0.5;
    let y = 0.5;
    const allowed = () => !closed && !blocked && !motion?.matches && !contrast?.matches && !document.hidden;
    const stop = () => {
      cancelAnimationFrame(animation);
      animation = 0;
      lastActivity = -Infinity;
      node.removeAttribute('data-light-active');
    };
    const release = () => {
      generation++;
      loading = false;
      stop();
      light?.dispose();
      light = undefined;
      host.replaceChildren();
      node.dataset.actionRenderer = 'css';
    };
    const fail = () => { blocked = true; release(); };
    const tick = (now: number) => {
      animation = 0;
      if (!allowed() || !light || !node.isConnected) { stop(); return; }
      const elapsed = (now - started) / 1000;
      const tail = Math.max(0, 1 - (now - lastActivity) / 700);
      if (tail <= 0) { stop(); return; }
      try { light.paint(x, y, elapsed, 0.9); } catch { fail(); return; }
      // A burst ends after 700 ms even while focused/hovered. Only actual input
      // restarts it; hidden documents and reduced motion never run a frame loop.
      animation = requestAnimationFrame(tick);
    };
    const animate = () => {
      if (!allowed()) return;
      lastActivity = performance.now();
      if (!animation) {
        started = lastActivity;
        node.dataset.lightActive = 'true';
        animation = requestAnimationFrame(tick);
      }
    };
    const activate = async () => {
      if (!allowed()) return;
      lastActivity = performance.now();
      if (light) { animate(); return; }
      if (loading || !navigator.gpu) return;
      loading = true;
      const version = generation;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      host.append(canvas);
      try {
        const { acquireActionLight } = await import('./action-light/runtime');
        if (closed || version !== generation) return;
        const ready = await acquireActionLight(canvas, fail);
        if (!allowed() || version !== generation) { ready.dispose(); canvas.remove(); return; }
        light = ready;
        node.dataset.actionRenderer = 'vgpu';
        // Don't start a delayed flourish after a touch has already navigated away.
        if (performance.now() - lastActivity < 700) animate();
      } catch (error) {
        if (!closed && version === generation) {
          console.debug('[Lupi action light] Using static feedback.', error);
          fail();
        }
      }
      finally { if (version === generation) loading = false; }
    };
    const pointer = (event: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      void activate();
    };
    const focus = () => { x = 0.5; y = 0.5; void activate(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') focus();
    };
    const preference = () => { if (!allowed()) release(); };
    node.addEventListener('pointerenter', pointer);
    node.addEventListener('pointermove', pointer);
    node.addEventListener('pointerdown', pointer);
    node.addEventListener('pointerleave', stop);
    node.addEventListener('focus', focus);
    node.addEventListener('blur', stop);
    node.addEventListener('keydown', key);
    motion?.addEventListener('change', preference);
    contrast?.addEventListener('change', preference);
    document.addEventListener('visibilitychange', preference);
    return () => {
      closed = true;
      release();
      node.removeEventListener('pointerenter', pointer);
      node.removeEventListener('pointermove', pointer);
      node.removeEventListener('pointerdown', pointer);
      node.removeEventListener('pointerleave', stop);
      node.removeEventListener('focus', focus);
      node.removeEventListener('blur', stop);
      node.removeEventListener('keydown', key);
      motion?.removeEventListener('change', preference);
      contrast?.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', preference);
    };
  }, [disabled]);
  return <button {...props} ref={button} type={type} disabled={disabled}
    className={`lupi-action ${className}`} data-action-renderer="css">
    <span className="lupi-action__light" ref={lightHost} aria-hidden="true" />
    <span className="lupi-action__content">{children}</span>
  </button>;
});
