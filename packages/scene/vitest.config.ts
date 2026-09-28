import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    server: {
      deps: {
        // drei 11 imports detect-gpu by name; its package has no `exports`,
        // so Node resolves the UMD `main`. Let Vite transform drei instead.
        inline: ['@react-three/drei'],
      },
    },
  }
});
