/// <reference types="vgpu/client" />
import { init, surface, type Gpu } from 'vgpu';
import type { Gist } from '@atlas/core/gist';
import { GIST_PARTICLE_COUNT, createGistEngine, type GistEngine } from './gistEngine';
import stepShader from './gist-step.wgsl';
import pointsShader from './gist-points.wgsl';

/**
 * Browser wiring for the gist engine: a canvas over the photo and an
 * animation loop that stops on its own when there is nothing left to show.
 * Fails soft: any init or validation error calls `onFailure` once and the
 * stage falls back to the fragment-only swirl, then to CSS.
 */
export interface GistParticles {
  setGist(gist: Gist | null): void;
  setEnergy(value: number): void;
  setAttract(value: number): void;
  setFade(value: number): void;
  dispose(): void;
}

/**
 * How many particles to summon. Sixty thousand is the medium-high setting:
 * dense enough to read as a skin on a 2-unit object at rest, cheap enough
 * for an integrated GPU (the kernel is a few dozen distance evaluations per
 * particle). Strong desktops get twice that, phones and low-power devices
 * half. `?particles=N` overrides for tuning.
 */
export function pickParticleCount(): number {
  if (typeof window === 'undefined') return GIST_PARTICLE_COUNT;
  const override = Number(new URLSearchParams(window.location.search).get('particles'));
  if (Number.isFinite(override) && override >= 1_000 && override <= 400_000) return Math.round(override);
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 8;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const mobile = coarse || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile || memory <= 4 || cores <= 4) return 30_000;
  if (cores >= 12 && memory >= 8) return 120_000;
  return GIST_PARTICLE_COUNT;
}

export async function createGistParticles(canvas: HTMLCanvasElement, onFailure: () => void): Promise<GistParticles> {
  let gpu: Gpu | undefined;
  let canvasTarget: ReturnType<typeof surface> | undefined;
  let engine: GistEngine | undefined;
  let offError: (() => void) | undefined;
  let animation = 0;
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animation);
    animation = 0;
    document.removeEventListener('visibilitychange', wake);
    offError?.();
    engine?.dispose();
    canvasTarget?.dispose();
    gpu?.dispose();
  };
  const fail = () => {
    dispose();
    onFailure();
  };
  const tick = (now: number) => {
    animation = 0;
    if (disposed || !engine) return;
    let more = false;
    try {
      more = engine.tick(now);
    } catch {
      fail();
      return;
    }
    if (more && !document.hidden) animation = requestAnimationFrame(tick);
  };
  function wake() {
    if (!animation && !disposed && !document.hidden) animation = requestAnimationFrame(tick);
  }

  try {
    // The vertex stage reads the particle storage buffer; that needs one
    // storage buffer in the vertex stage, which is not in the default limits.
    // An adapter that cannot grant it fails here and the stage falls back.
    gpu = await init({ powerPreference: 'high-performance', label: 'Lupi gist particles', requiredLimits: { maxStorageBuffersInVertexStage: 1 } });
    canvasTarget = surface(gpu, canvas, { dpr: [1, 2], alphaMode: 'premultiplied', clearColor: [0, 0, 0, 0] });
    engine = createGistEngine({
      gpu,
      target: canvasTarget,
      shaders: { step: stepShader, points: pointsShader },
      count: pickParticleCount(),
      aspect: () => Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1),
    });
    offError = gpu.onError(fail);
    const failureRef = { current: fail as (() => void) | undefined };
    void gpu.gpu.lost.then(() => failureRef.current?.());
    const unsubscribe = offError;
    offError = () => {
      failureRef.current = undefined;
      unsubscribe();
    };
    // Validate one submitted frame before the page trusts the stage.
    gpu.gpu.pushErrorScope('validation');
    let renderError: unknown;
    try {
      engine.tick(performance.now());
    } catch (error) {
      renderError = error;
    }
    const validation = await gpu.gpu.popErrorScope();
    if (renderError || validation) throw renderError ?? validation;
    await gpu.gpu.queue.onSubmittedWorkDone();
    if (disposed) throw new Error('Gist stage lost during initialization');
    document.addEventListener('visibilitychange', wake);
    return {
      setGist(gist) {
        engine!.setGist(gist);
        wake();
      },
      setEnergy(value) {
        engine!.setEnergy(value);
        wake();
      },
      setAttract(value) {
        engine!.setAttract(value);
        wake();
      },
      setFade(value) {
        engine!.setFade(value);
        wake();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
