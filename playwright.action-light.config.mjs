import { defineConfig } from 'playwright/test';
import base from './playwright.config.mjs';
import { LANE_ARGS } from './tools/lib/browser-lanes.mjs';

// The action-light shader check: the ordinary lane-L config (web server,
// timeouts, reporters) with a WebGPU adapter. The base config ignores
// *.webgpu.spec.ts; this lane runs only that spec.
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/action-light.webgpu.spec.ts',
  outputDir: 'test-results/action-light',
  projects: [{ name: 'chromium', use: { ...base.projects[0].use, hasTouch: true } }],
  use: {
    ...base.use,
    // WebGPU needs the full Chromium build, not the headless shell.
    channel: 'chromium',
    reducedMotion: 'no-preference',
    hasTouch: true,
    // The software lane (lane G, tools/lib/browser-lanes.mjs) is the portable
    // default. Opt in explicitly for a local native-adapter receipt; neither
    // lane is physical-phone performance proof.
    launchOptions: {
      ...base.use.launchOptions,
      args: process.env.LUPI_ACTION_GPU === 'native' ? ['--enable-unsafe-webgpu'] : [...LANE_ARGS.webgpu],
    },
  },
});
