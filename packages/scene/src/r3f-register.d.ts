// Lupi renders only through WebGPURenderer (WebGPU, or its WebGL2 fallback).
// Registering the renderer narrows `state.renderer` and the deprecated
// `state.gl` to WebGPURenderer for types that come through the root fiber
// entry (drei 11 uses it), matching what `@react-three/fiber/webgpu` gives
// Lupi code. fiber v10's RootState has no `clock`: use `state.elapsed` and
// `state.delta`, so a missed `state.clock` is a type error.
export {};

declare module '@react-three/fiber' {
  interface Register {
    renderer: 'webgpu';
  }
}
