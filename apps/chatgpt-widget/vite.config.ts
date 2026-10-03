import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/** An MCP UI resource has no ambient asset URL. Emit a single portable HTML
 * document: no external scripts, stylesheets, fonts or CDN dependencies. */
function inlineUiResource(): Plugin {
  return {
    name: 'lupi-inline-mcp-ui',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') throw new Error('The widget build did not produce index.html.');
      let source = String(html.source);
      for (const [name, output] of Object.entries(bundle)) {
        if (output.type === 'chunk') {
          if (!output.isEntry || output.imports.length || output.dynamicImports.length) {
            throw new Error(`MCP UI must be self-contained; unexpected JavaScript chunk: ${name}`);
          }
          const script = `<script type="module">${output.code.replace(/<\/script/gi, '<\\/script')}</script>`;
          source = source.replace(/<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script>/, () => script);
          delete bundle[name];
        } else if (name.endsWith('.css')) {
          const style = `<style>${String(output.source).replace(/<\/style/gi, '<\\/style')}</style>`;
          source = source.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/, () => style);
          delete bundle[name];
        } else if (name !== 'index.html') {
          throw new Error(`MCP UI must inline all assets; unexpected asset: ${name}`);
        }
      }
      source = source.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/g, '');
      if (/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="stylesheet"/i.test(source)) {
        throw new Error('The MCP UI still references an external script or stylesheet.');
      }
      html.source = source;
    },
  };
}

/** The shared canvas reports renderer failures through the web app's event
 * layer. In the embedded app, preserve that signal locally without importing
 * Firebase/account state or making telemetry requests from a host iframe. */
function embeddedRendererEvents(): Plugin {
  return {
    name: 'lupi-embedded-renderer-events',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === './analytics' && importer?.replaceAll('\\', '/').endsWith('/ui/src/CanvasErrorBoundary.tsx')) {
        return path.join(here, 'src/renderEvents.ts');
      }
      return undefined;
    },
    transform(code, id) {
      if (id.replaceAll('\\', '/').endsWith('/@react-three/drei/webgpu/index.mjs')) {
        // drei 11 alpha eagerly opens Three's developer-inspector settings,
        // even when only OrbitControls is imported. That optional inspector
        // reads localStorage at module load and cannot run in an opaque host
        // iframe. Omit its unused warmup here; do not fabricate persistence or
        // weaken the host sandbox. All viewer/control code stays unchanged.
        const warmup = /if \(typeof window !== "undefined"\) \{\s*await import\('three\/examples\/jsm\/inspector\/tabs\/Settings\.js'\);\s*\}/g;
        if (Array.from(code.matchAll(warmup)).length !== 1) {
          throw new Error('The pinned drei inspector warmup changed; review the embedded-host build before upgrading.');
        }
        return { code: code.replace(warmup, ''), map: null };
      }
      // Source topology disables bond inference. Inline the existing shared
      // worker modules as well so even the unused paths have no asset fetch.
      if (/\.[jt]sx?$/.test(id) && /\?worker['"]/.test(code)) {
        return { code: code.replace(/\?worker(?=['"])/g, '?worker&inline'), map: null };
      }
      return undefined;
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [embeddedRendererEvents(), react(), inlineUiResource()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei', '@react-three/tsl'],
  },
  optimizeDeps: {
    // Keep the host-safe inspector transform active in local development too.
    exclude: ['@react-three/drei'],
    esbuildOptions: { target: 'esnext' },
  },
  build: {
    target: 'esnext',
    cssCodeSplit: false,
    assetsInlineLimit: Infinity,
    modulePreload: false,
    sourcemap: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  worker: { format: 'es' },
});
