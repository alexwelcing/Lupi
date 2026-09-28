/**
 * webgpuCompat.ts — a tolerant GPUTexture.createView for three r186.
 *
 * three r186 puts `swizzle: 'rgba'` (a string: the current spec shape of the
 * 'texture-component-swizzle' feature) on every GPUTextureViewDescriptor.
 * Chromium 141 with unsafe WebGPU (the headless SwiftShader lane) still
 * implements the older dictionary shape, `{ r, g, b, a }`, and createView()
 * throws a TypeError, so nothing renders (spike G6, lead probe L2).
 *
 * The wrapper calls the original first, so a browser that accepts the string
 * pays nothing. Only when createView throws a TypeError for a descriptor with a
 * string swizzle does it retry: the identity swizzle is dropped, any other one
 * is converted to the dictionary shape. After the first such TypeError the
 * conversion happens up front, without the throw.
 */

export interface WebGPUCompatState {
  /** True once the swizzle retry has fired at least once in this page. */
  swizzleRetry: boolean;
}

/** Live, shared state; the renderer runtime record exposes this object. */
export const webgpuCompatState: WebGPUCompatState = { swizzleRetry: false };

type CreateView = (this: GPUTexture, descriptor?: GPUTextureViewDescriptor) => GPUTextureView;

const INSTALLED = Symbol.for('lupi.webgpuCompat.createView');

const SWIZZLE_COMPONENTS: Record<string, string> = {
  r: 'r',
  g: 'g',
  b: 'b',
  a: 'a',
  '0': 'zero',
  '1': 'one',
};

/** The descriptor without its string swizzle, in the shape older builds accept. */
function withDictionarySwizzle(descriptor: GPUTextureViewDescriptor): GPUTextureViewDescriptor {
  const source = descriptor as unknown as Record<string, unknown>;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (key !== 'swizzle' && source[key] !== undefined) copy[key] = source[key];
  }
  const swizzle = source.swizzle as string;
  if (swizzle !== 'rgba' && swizzle.length === 4) {
    copy.swizzle = {
      r: SWIZZLE_COMPONENTS[swizzle[0]] ?? 'r',
      g: SWIZZLE_COMPONENTS[swizzle[1]] ?? 'g',
      b: SWIZZLE_COMPONENTS[swizzle[2]] ?? 'b',
      a: SWIZZLE_COMPONENTS[swizzle[3]] ?? 'a',
    };
  }
  return copy as unknown as GPUTextureViewDescriptor;
}

function hasStringSwizzle(descriptor: GPUTextureViewDescriptor | undefined): descriptor is GPUTextureViewDescriptor {
  return typeof (descriptor as { swizzle?: unknown } | undefined)?.swizzle === 'string';
}

/**
 * Install the createView wrapper. Idempotent (also across module copies), and a
 * no-op where WebGPU is absent (no `GPUTexture`). Called by the renderer
 * factory before the first WebGPURenderer is created.
 */
export function installWebGPUCompat(): void {
  const GPUTextureClass = (globalThis as { GPUTexture?: { prototype: GPUTexture } }).GPUTexture;
  if (!GPUTextureClass) return;
  const prototype = GPUTextureClass.prototype as GPUTexture & { [INSTALLED]?: true };
  if (prototype[INSTALLED]) return;

  const original = prototype.createView as CreateView;
  let stringSwizzleRejected = false;

  function createView(this: GPUTexture, descriptor?: GPUTextureViewDescriptor): GPUTextureView {
    if (stringSwizzleRejected && hasStringSwizzle(descriptor)) {
      return original.call(this, withDictionarySwizzle(descriptor));
    }
    try {
      return original.call(this, descriptor);
    } catch (error) {
      if (!(error instanceof TypeError) || !hasStringSwizzle(descriptor)) throw error;
      stringSwizzleRejected = true;
      webgpuCompatState.swizzleRetry = true;
      return original.call(this, withDictionarySwizzle(descriptor));
    }
  }

  Object.defineProperty(prototype, 'createView', { configurable: true, writable: true, value: createView });
  Object.defineProperty(prototype, INSTALLED, { configurable: true, value: true });
}
