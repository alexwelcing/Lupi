// three r186 puts `swizzle: 'rgba'` (a string, the current spec shape of the
// 'texture-component-swizzle' feature) on EVERY GPUTextureViewDescriptor.
// Chromium 141 with --enable-unsafe-webgpu exposes the older dictionary shape
// (GPUTextureComponentSwizzle {r,g,b,a}) and throws a TypeError from
// createView(), so nothing renders. Stable browsers that do not expose the member
// ignore it. This shim is for the headless SwiftShader lane only (?noshim=1 disables it).
export const swizzleShimActive = (() => {
  if (new URLSearchParams(location.search).get('noshim') === '1') return false;
  const G = (globalThis as unknown as { GPUTexture?: { prototype: { createView: (d?: unknown) => unknown } } }).GPUTexture;
  if (!G) return false;
  const orig = G.prototype.createView;
  G.prototype.createView = function (this: unknown, d?: unknown) {
    const desc = d as Record<string, unknown> | undefined;
    if (desc && typeof desc.swizzle === 'string') {
      const copy: Record<string, unknown> = {};
      for (const k of Object.keys(desc)) if (k !== 'swizzle' && desc[k] !== undefined) copy[k] = desc[k];
      const s = desc.swizzle as string;
      if (s !== 'rgba') copy.swizzle = { r: s[0], g: s[1], b: s[2], a: s[3] };
      return orig.call(this, copy);
    }
    return orig.call(this, desc);
  };
  return true;
})();
