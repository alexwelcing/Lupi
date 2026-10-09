import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setupTests.ts'],
    // maath (through drei) has no `exports`, and Vitest resolves `main`, its
    // CJS build, which `require`s three's deprecated CJS build. Its ESM build
    // imports three's ESM build like everything else.
    alias: [{ find: /^maath$/, replacement: 'maath/dist/maath.esm.js' }],
    server: {
      deps: {
        // drei 11 imports detect-gpu by name; its package has no `exports`,
        // so Node resolves the UMD `main`. Let Vite transform drei instead.
        inline: ['@react-three/drei'],
      },
    },
  }
});
