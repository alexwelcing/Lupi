import { effect, frame, init, surface, type Effect, type Gpu } from 'vgpu';
import shader from './action-light.wgsl';

export interface ActionLight {
  paint(x: number, y: number, phase: number, energy: number): void;
  dispose(): void;
}
interface SharedLight { gpu: Gpu; field: Effect; users: number }
let pending: Promise<SharedLight> | undefined;
let unavailable = false;

// One device and compiled effect for all enhanced actions. No Three.js import,
// frame loop or adapter request on page load; the last consumer owns teardown.
export async function acquireActionLight(canvas: HTMLCanvasElement, onFailure: () => void): Promise<ActionLight> {
  if (unavailable) throw new Error('Action light unavailable');
  const shared = await (pending ??= init({ powerPreference: 'low-power', label: 'Lupi action light' })
    .then(gpu => {
      try {
        return { gpu, field: effect(gpu, shader, { label: 'Lupi optical action field' }), users: 0 };
      } catch (error) { gpu.dispose(); throw error; }
    }).catch(error => { unavailable = true; pending = undefined; throw error; }));
  shared.users++;
  const { gpu, field } = shared;
  let disposed = false;
  let target: ReturnType<typeof surface> | undefined;
  let offError: (() => void) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    offError?.();
    target?.dispose();
    if (--shared.users === 0) { pending = undefined; gpu.dispose(); }
  };
  const fail = () => { unavailable = true; dispose(); onFailure(); };
  try {
    target = surface(gpu, canvas, { dpr: [1, 1.5], alphaMode: 'premultiplied', clearColor: [0, 0, 0, 0] });
    offError = gpu.onError(fail);
    // Do not retain a canvas/component in device.lost's pending promise.
    const failureRef = { current: fail as (() => void) | undefined };
    void gpu.gpu.lost.then(() => failureRef.current?.());
    const unsubscribe = offError;
    offError = () => { failureRef.current = undefined; unsubscribe(); };
    const paint = (x: number, y: number, phase: number, energy: number) => {
      if (disposed || !target) return;
      field.set({ resolution: [canvas.clientWidth, canvas.clientHeight], pointer: [x, y], phase, energy });
      frame(gpu, pass => pass.pass(target!, field));
    };
    // Validate a submitted frame before the UI advertises the GPU enhancement.
    gpu.gpu.pushErrorScope('validation');
    let renderError: unknown;
    try { paint(0.5, 0.5, 0, 0); } catch (error) { renderError = error; }
    const validation = await gpu.gpu.popErrorScope();
    if (renderError || validation) throw renderError ?? validation;
    await gpu.gpu.queue.onSubmittedWorkDone();
    if (disposed) throw new Error('Action light lost during initialization');
    return { paint, dispose };
  } catch (error) { dispose(); throw error; }
}
