import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@atlas/core': fileURLToPath(new URL('../../packages/core/src', import.meta.url)),
    },
  },
  test: { environment: 'node' },
});
