/// <reference types="vgpu/client" />
import { effect, frame, init, surface, type Effect, type Gpu } from 'vgpu';
import shader from './scan-swirl.wgsl';

/**
 * The scan swirl (vgpu, Vercel Labs). One device, one fullscreen effect, one
 * canvas over the photo preview. `setEnergy(1)` starts the whirl; `reveal()`
 * tightens and fades it as the answer lands; the loop stops on its own once
 * nothing is left to draw. No Three.js, no store, no network.
 *
 * Fails soft: any init or validation error calls `onFailure` once and the
 * page falls back to a CSS animation. Reduced motion never starts the loop.
 */
export interface ScanSwirl {
  setEnergy(target: number): void;
  reveal(): void;
  dispose(): void;
}

const EASE = 0.08;

export async function createScanSwirl(canvas: HTMLCanvasElement, onFailure: () => void): Promise<ScanSwirl> {
  let gpu: Gpu | undefined;
  let field: Effect | undefined;
  let target: ReturnType<typeof surface> | undefined;
  let offError: (() => void) | undefined;
  let animation = 0;
  let disposed = false;
  let energy = 0;
  let energyTarget = 0;
  let revealValue = 0;
  let revealTarget = 0;
  const seed = Math.random() * 100;
  const started = performance.now();

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animation);
    animation = 0;
    offError?.();
    target?.dispose();
    gpu?.dispose();
  };
  const fail = () => {
    dispose();
    onFailure();
  };

  const paint = () => {
    if (disposed || !gpu || !field || !target) return;
    field.set({
      resolution: [Math.max(canvas.clientWidth, 1), Math.max(canvas.clientHeight, 1)],
      time: (performance.now() - started) / 1000,
      energy,
      reveal: revealValue,
      seed,
    });
    frame(gpu, (pass) => pass.pass(target!, field!));
  };

  const tick = () => {
    animation = 0;
    if (disposed) return;
    energy += (energyTarget - energy) * EASE;
    revealValue += (revealTarget - revealValue) * EASE * 1.4;
    if (Math.abs(energyTarget - energy) < 0.002) energy = energyTarget;
    if (Math.abs(revealTarget - revealValue) < 0.002) revealValue = revealTarget;
    try {
      paint();
    } catch {
      fail();
      return;
    }
    // Keep drawing while there is motion or light left; a settled, dark
    // swirl costs nothing.
    if (energy > 0.002 || energyTarget > 0 || revealValue !== revealTarget) {
      if (!document.hidden) animation = requestAnimationFrame(tick);
    }
  };
  const wake = () => {
    if (!animation && !disposed) animation = requestAnimationFrame(tick);
  };
  const onVisibility = () => {
    if (!document.hidden) wake();
  };

  try {
    gpu = await init({ powerPreference: 'high-performance', label: 'Lupi scan swirl' });
    field = effect(gpu, shader, { label: 'Lupi scan swirl' });
    target = surface(gpu, canvas, { dpr: [1, 2], alphaMode: 'premultiplied', clearColor: [0, 0, 0, 0] });
    offError = gpu.onError(fail);
    const failureRef = { current: fail as (() => void) | undefined };
    void gpu.gpu.lost.then(() => failureRef.current?.());
    const unsubscribe = offError;
    offError = () => {
      failureRef.current = undefined;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Validate one submitted frame before the page trusts the effect.
    gpu.gpu.pushErrorScope('validation');
    let renderError: unknown;
    try {
      paint();
    } catch (error) {
      renderError = error;
    }
    const validation = await gpu.gpu.popErrorScope();
    if (renderError || validation) throw renderError ?? validation;
    await gpu.gpu.queue.onSubmittedWorkDone();
    if (disposed) throw new Error('Scan swirl lost during initialization');
    document.addEventListener('visibilitychange', onVisibility);
    return {
      setEnergy(value) {
        energyTarget = Math.max(0, Math.min(1, value));
        if (energyTarget > 0) revealTarget = 0;
        wake();
      },
      reveal() {
        revealTarget = 1;
        energyTarget = 0;
        wake();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
