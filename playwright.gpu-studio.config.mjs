import { defineConfig } from 'playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/gpu-studio.webgpu.spec.ts',
  outputDir: 'test-results/gpu-studio',
  use: {
    ...base.use,
    channel: 'chromium',
    launchOptions: {
      ...base.use.launchOptions,
      // Explicit software execution, not hardware-performance proof.
      args: [
        '--enable-unsafe-webgpu',
        '--enable-unsafe-swiftshader',
        '--use-webgpu-adapter=swiftshader',
        '--use-angle=swiftshader',
      ],
    },
  },
});
