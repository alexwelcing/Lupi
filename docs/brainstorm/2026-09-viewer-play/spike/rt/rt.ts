import * as THREE from 'three/webgpu';
import { color, float } from 'three/tsl';

const q = new URLSearchParams(location.search);
const forceWebGL = q.get('backend') === 'webgl';
const W = 100, H = 60;
const out: Record<string, unknown> = { done: false };
(window as any).__rt = out;

// Shim for Chromium 141 + --enable-unsafe-webgpu (G6), as a page-level patch.
const G = (globalThis as any).GPUTexture;
if (G) { const o = G.prototype.createView; G.prototype.createView = function (d?: any) { if (d && typeof d.swizzle === 'string') { const c: any = {}; for (const k of Object.keys(d)) if (k !== 'swizzle' && d[k] !== undefined) c[k] = d[k]; return o.call(this, c); } return o.call(this, d); }; }

function quad(x0: number, y0: number, x1: number, y1: number, hex: string, opacity = 1) {
  const g = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(hex);
  if (opacity < 1) { m.transparent = true; m.opacityNode = float(opacity); }
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return mesh;
}

async function main() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const renderer = new THREE.WebGPURenderer({ canvas, alpha: true, antialias: false, forceWebGL });
  await renderer.init();
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  out.backend = (renderer.backend as any).isWebGPUBackend ? 'webgpu' : 'webgl2';
  // Camera: x in [0,100], y in [0,60] with y up; top-left quad = small x, large y.
  const cam = new THREE.OrthographicCamera(0, W, H, 0, -10, 10);
  const scene = new THREE.Scene();
  scene.add(quad(0, 40, 20, 60, '#ff0000'));        // top-left red
  scene.add(quad(40, 20, 60, 40, '#808080'));       // centre grey (sRGB 128)
  scene.add(quad(80, 0, 100, 20, '#ff8000', 0.5));  // bottom-right half-transparent orange
  renderer.render(scene, cam);
  // Canvas readback in the same task (current texture / drawing buffer still valid).
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const ctx = c2.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  const cd = ctx.getImageData(0, 0, W, H).data;
  const px = (d: ArrayLike<number>, x: number, y: number, stride = W * 4) => Array.from({ length: 4 }, (_, i) => d[y * stride + x * 4 + i]);
  out.canvas = { topLeft: px(cd, 5, 5), grey: px(cd, 50, 30), orange: px(cd, 90, 55), corner: px(cd, 99, 0) };

  for (const variant of ['srgb', 'none'] as const) {
    const rt = new THREE.RenderTarget(W, H, { type: THREE.UnsignedByteType, samples: 0, colorSpace: variant === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace });
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    const data = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H) as Uint8Array;
    const stride = data.length >= H * 256 * Math.ceil((W * 4) / 256) - (Math.ceil((W * 4) / 256) * 256 - W * 4) && data.length !== W * H * 4 ? Math.ceil((W * 4) / 256) * 256 : W * 4;
    // Find which row holds red (row 5 from top vs from bottom).
    const redTopRow = px(data, 5, 5, stride), redBottomRow = px(data, 5, H - 1 - 5, stride);
    out['rt_' + variant] = {
      length: data.length, tight: W * H * 4, strideUsed: stride,
      row5_x5: redTopRow, rowH6_x5: redBottomRow,
      grey: px(data, 50, 30, stride),
      orangeIfTopOrigin: px(data, 90, 55, stride), orangeIfBottomOrigin: px(data, 90, H - 1 - 55, stride),
      cornerTopRight_topOrigin: px(data, 99, 0, stride),
    };
    rt.dispose();
  }
  {
    const rt = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, samples: 0 });
    renderer.setRenderTarget(rt); renderer.render(scene, cam); renderer.setRenderTarget(null);
    try {
      const data = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H) as any;
      const h2f = (h: number) => { const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff; return e === 0 ? s * 2 ** -14 * (f / 1024) : e === 31 ? NaN : s * 2 ** (e - 15) * (1 + f / 1024); };
      const bpp = 8; const rowBytes = W * bpp; const strideBytes = data.byteLength === W * H * bpp ? rowBytes : Math.ceil(rowBytes / 256) * 256;
      const u16 = new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2);
      const pxh = (x: number, y: number) => Array.from({ length: 4 }, (_, i) => +h2f(u16[(y * strideBytes + x * bpp) / 2 + i]).toFixed(4));
      out.rt_half = { ctor: data.constructor.name, byteLength: data.byteLength, tightBytes: W * H * bpp, top5: pxh(5, 5), bottom5: pxh(5, H - 6), grey: pxh(50, 30), orangeTop: pxh(90, 55), orangeBottom: pxh(90, H - 1 - 55) };
    } catch (e) { out.rt_half = { error: String(e) }; }
    rt.dispose();
  }
  // Canvas once more for the screenshot comparison.
  renderer.render(scene, cam);
  out.done = true;
}
main().catch((e) => { out.error = String(e?.stack ?? e); out.done = true; });
