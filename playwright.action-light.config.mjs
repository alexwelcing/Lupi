import { defineConfig } from 'playwright/test';
import base from './playwright.gpu-studio.config.mjs';

export default defineConfig({
  ...base,
  testMatch: '**/action-light.webgpu.spec.ts',
  outputDir: 'test-results/action-light',
  projects: [{ name: 'chromium', use: { ...base.projects[0].use, hasTouch: true } }],
  use: {
    ...base.use,
    reducedMotion: 'no-preference',
    hasTouch: true,
    // The software lane is the portable default. Opt in explicitly for a local
    // native-adapter receipt; neither lane is physical-phone performance proof.
    ...(process.env.LUPI_ACTION_GPU === 'native' ? {
      launchOptions: { ...base.use.launchOptions, args: ['--enable-unsafe-webgpu'] },
    } : {}),
  },
});
