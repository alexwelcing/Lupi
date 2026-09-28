/**
 * browser-lanes.mjs — the one source of Chromium flags for Lupi's browser lanes
 * (plan-final §5.16). The smoke harness and the Playwright configs import it.
 *
 * - `webgpu` (lane G): a SwiftShader WebGPU adapter. Without the Vulkan pair
 *   and `--use-angle=swiftshader`, SwiftShader loses the device within the
 *   first frames (lead probe L1, spike G7).
 * - `webgl2` (lane L): no WebGPU, so WebGPURenderer runs its WebGL2 backend.
 *   Never add `--enable-unsafe-webgpu` here: with both flags navigator.gpu
 *   still yields an adapter.
 * - `noGpu`: neither WebGPU nor WebGL, for the renderer fallback screen. It
 *   takes no `--enable-unsafe-*` flag.
 */
import { existsSync } from 'node:fs';

export const CHROMIUM_1194 = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const LANE_ARGS = {
  webgpu: [
    '--enable-unsafe-webgpu',
    '--enable-unsafe-swiftshader',
    '--use-webgpu-adapter=swiftshader',
    '--use-angle=swiftshader',
    '--use-vulkan=swiftshader',
    '--enable-features=Vulkan',
  ],
  webgl2: ['--disable-webgpu', '--enable-unsafe-swiftshader'],
  noGpu: ['--disable-webgpu', '--disable-webgl', '--disable-gpu', '--disable-software-rasterizer'],
};

/**
 * The Chromium binary for local lanes: an explicit path, else Chromium 1194
 * when installed, else $PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, else null
 * (Playwright's own browser).
 */
export function chromiumExecutable(explicit) {
  if (explicit) return explicit;
  if (existsSync(CHROMIUM_1194)) return CHROMIUM_1194;
  return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim() || null;
}
