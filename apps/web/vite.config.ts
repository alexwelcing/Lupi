import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { execFileSync } from 'node:child_process';

const FULL_GIT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function repositoryHeadSha(): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim().toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * React 19.2's development build emits a Performance "Components" measure for
 * every render and includes changed-prop details. Molecular frames contain
 * large typed arrays, so a playing trajectory can make Chromium clone and
 * retain hundreds of megabytes of diagnostic detail until the preview fails
 * with `DataCloneError: ... out of memory`.
 *
 * Disable those React-only development tracks before React initializes. The
 * real in-app telemetry and production bundle are unaffected, and developers
 * can explicitly opt back into a short profiling session with
 * `?reactProfile=1`.
 */
export function reactPerformanceTrackGuardPlugin() {
  return {
    name: 'lupi-react-performance-track-guard',
    apply: 'serve' as const,
    transformIndexHtml: {
      order: 'pre' as const,
      handler() {
        return [{
          tag: 'script',
          injectTo: 'head-prepend' as const,
          children: `(() => {
  if (new URLSearchParams(window.location.search).get('reactProfile') === '1') return;
  if (typeof console.timeStamp !== 'function') return;
  Object.defineProperty(console, 'timeStamp', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  window.__lupiReactPerformanceTracksDisabled = true;
})();`,
        }];
      },
    },
  };
}

/** Resolve the exact identity Vite will compile into browser renderer code. */
export function resolveLupiBrowserBuildSha(
  command: 'build' | 'serve',
  environment: NodeJS.ProcessEnv = process.env,
  readHead: () => string | undefined = repositoryHeadSha,
): string | undefined {
  const requested = environment.VITE_LUPI_BUILD_SHA?.trim().toLowerCase();
  if (requested && !FULL_GIT_SHA_PATTERN.test(requested)) {
    throw new Error('VITE_LUPI_BUILD_SHA must be an exact 40-hex Git SHA.');
  }
  if (command === 'serve') return requested || undefined;

  const head = readHead()?.trim().toLowerCase();
  if (head && !FULL_GIT_SHA_PATTERN.test(head)) {
    throw new Error('git rev-parse HEAD did not return an exact 40-hex Git SHA.');
  }
  if (requested && head && requested !== head) {
    throw new Error(
      `VITE_LUPI_BUILD_SHA ${requested} does not match the checked-out Git HEAD ${head}.`,
    );
  }
  const resolved = requested || head;
  if (!resolved) {
    throw new Error(
      'Production web builds require VITE_LUPI_BUILD_SHA or a readable exact Git HEAD.',
    );
  }
  return resolved;
}

/**
 * Gallery Asset Upload Plugin
 *
 * Provides a dev-server endpoint that receives exported image/GLB blobs
 * from the BatchAssetGenerator and writes them directly to the public
 * gallery directories. This avoids 300+ manual downloads.
 *
 * POST /api/gallery-assets/upload
 * Body: multipart/form-data with fields:
 *   - id: gallery example id
 *   - type: 'snapshot' | 'model'
 *   - file: Blob
 */
function galleryAssetUploadPlugin() {
  return {
    name: 'gallery-asset-upload',
    configureServer(server: any) {
      server.middlewares.use('/api/gallery-assets/upload', async (req: any, res: any, next: any) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const contentType = req.headers['content-type'] || '';

            if (!contentType.includes('multipart/form-data')) {
              res.statusCode = 400;
              res.end('Expected multipart/form-data');
              return;
            }

            const boundary = contentType.split('boundary=')[1];
            if (!boundary) {
              res.statusCode = 400;
              res.end('Missing boundary');
              return;
            }

            const parts = parseMultipart(buffer, boundary);
            const idField = parts.find((p: any) => p.name === 'id');
            const typeField = parts.find((p: any) => p.name === 'type');
            const fileField = parts.find((p: any) => p.filename);

            if (!idField || !typeField || !fileField) {
              res.statusCode = 400;
              res.end('Missing required fields');
              return;
            }

            const id = idField.data.toString('utf-8').trim();
            const type = typeField.data.toString('utf-8').trim();
            const ext = type === 'snapshot' ? 'jpg' : 'glb';

            const outDir = path.resolve(
              __dirname,
              type === 'snapshot' ? '../../public/gallery/snapshots' : '../../public/gallery/models'
            );
            fs.mkdirSync(outDir, { recursive: true });

            const outPath = path.join(outDir, `${id}.${ext}`);
            fs.writeFileSync(outPath, fileField.data);

            console.log(`[gallery-assets] ${type === 'snapshot' ? '📸' : '📦'} ${id}.${ext} (${(fileField.data.length / 1024).toFixed(1)} KB)`);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, path: outPath, size: fileField.data.length }));
          } catch (err: any) {
            console.error('[gallery-assets] Upload error:', err.message);
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      });
    },
  };
}

/**
 * External-Hosted Asset Pruning Plugin
 *
 * Some trajectory payloads are too large for Workers static assets (25 MiB per
 * file) or are intended to live in object storage. The dev server still serves
 * them from /public/ for offline work, but production builds must not ship them
 * in dist. The Cloudflare Worker proxies these paths from object storage.
 *
 * The explicit Cloudflare list lives next to this config so Wrangler dry-runs
 * stay deployable without removing local development fixtures.
 */
function pruneExternalHostedAssets() {
  const STASH_LISTS = [
    path.resolve(__dirname, 'public/gallery/open_data/.gcs-hosted.json'),
    path.resolve(__dirname, 'cloudflare-assets-exclude.json'),
  ];
  return {
    name: 'prune-external-hosted-assets',
    apply: 'build' as const,
    closeBundle() {
      const distDir = path.resolve(__dirname, 'dist');
      let removed = 0;
      for (const listPath of STASH_LISTS) {
        if (!fs.existsSync(listPath)) continue;
        const parsed: unknown = JSON.parse(fs.readFileSync(listPath, 'utf-8'));
        if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) {
          throw new Error(`${listPath} must contain an array of relative asset paths`);
        }
        const list = [...new Set(parsed)];
        if (list.length !== parsed.length) throw new Error(`${listPath} contains duplicate asset paths`);
        for (const rel of list) {
          if (
            rel.length === 0 || path.isAbsolute(rel) || rel.includes('\\') || rel.includes('?') || rel.includes('#') ||
            rel.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
          ) {
            throw new Error(`${listPath} contains unsafe asset path: ${rel}`);
          }
          const p = path.resolve(distDir, ...rel.split('/'));
          const relativeToDist = path.relative(distDir, p);
          if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
            throw new Error(`${listPath} asset path escapes dist: ${rel}`);
          }
          if (fs.existsSync(p)) {
            fs.unlinkSync(p);
            removed++;
          }
        }
      }
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`[prune-external-hosted-assets] excluded ${removed} files from dist (served from object storage at runtime)`);
      }
    },
  };
}

function parseMultipart(buffer: Buffer, boundary: string): any[] {
  const parts: any[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  let start = buffer.indexOf(boundaryBuffer);
  while (start !== -1) {
    let end = buffer.indexOf(boundaryBuffer, start + boundaryBuffer.length);
    if (end === -1) break;
    const part = buffer.slice(start + boundaryBuffer.length, end);
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = end; continue; }
    const headers = part.slice(0, headerEnd).toString('utf-8');
    const data = part.slice(headerEnd + 4, part.length - 2); // strip trailing \r\n

    const nameMatch = headers.match(/name="([^"]+)"/);
    const filenameMatch = headers.match(/filename="([^"]+)"/);

    parts.push({
      name: nameMatch ? nameMatch[1] : undefined,
      filename: filenameMatch ? filenameMatch[1] : undefined,
      data,
    });
    start = end;
  }
  return parts;
}

export default defineConfig(({ command }) => ({
  define: {
    // Never let an unpinned production bundle fall back to a mutable module
    // URL. Development intentionally receives an empty value unless pinned.
    'import.meta.env.VITE_LUPI_BUILD_SHA': JSON.stringify(
      resolveLupiBrowserBuildSha(command) ?? '',
    ),
    // URL-authored MCP commands are a localhost preview/debug affordance.
    // Enable the documented dev workflow without requiring an undiscoverable
    // shell variable; production builds remain fail-closed.
    'import.meta.env.VITE_MCP_URL_AUTORUN': JSON.stringify(
      command === 'serve' ? (process.env.VITE_MCP_URL_AUTORUN ?? 'true') : 'false',
    ),
  },
  // Clean public routes like /scenes/1m-copper-lattice need bundle assets to
  // resolve from the site root after the server falls back to index.html.
  base: '/',
  plugins: [
    reactPerformanceTrackGuardPlugin(),
    react(),
    galleryAssetUploadPlugin(),
    pruneExternalHostedAssets(),
  ],
  // The WASM parsers live ONLY inside web workers (parse/transcode workers),
  // and vite-plugin-wasm needs top-level-await for the wasm glue. Scoping both
  // plugins to the worker build keeps top-level-await OFF the main graph — the
  // TLA transform was statically sequencing chunk init and dragging the
  // three/R3F vendor chunk onto the landing entry. The main thread imports no
  // .wasm and uses no top-level await, so it needs neither plugin.
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  resolve: {
    dedupe: ['three', '@react-three/fiber', '@react-three/drei', 'react', 'react-dom', 'zustand'],
    alias: {
      '@atlas/core': path.resolve(__dirname, '../../packages/core/src'),
      '@atlas/parsers': path.resolve(__dirname, '../../packages/parsers/src'),
      'atlas-parsers': path.resolve(__dirname, '../../packages/parsers/pkg'),
      '@atlas/renderer': path.resolve(__dirname, '../../packages/renderer/src'),
      '@atlas/scene': path.resolve(__dirname, '../../packages/scene/src'),
      '@atlas/ui': path.resolve(__dirname, '../../packages/ui/src'),
      '@atlas/export': path.resolve(__dirname, '../../packages/export/src'),
    },
  },
  optimizeDeps: {
    exclude: ['atlas-parsers'],
  },
  build: {
    target: 'esnext',
    sourcemap: false,
    // Kept tight on purpose: a chunk over this size is a signal to split, not
    // something to silence. (Was 3000, which hid the 2.6MB App chunk entirely.)
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Vite's dynamic-import preload helper (__vitePreload) is imported by
          // the entry AND every dynamic chunk, so Rollup hoists it to a shared
          // chunk — and it was landing INSIDE vendor-react-three, which forced
          // the landing entry to static-import that chunk (dragging three onto
          // the marketing critical path) purely to get the helper. Pin it to a
          // tiny dedicated chunk so the entry imports ~nothing and three stays
          // an App-only dependency.
          if (id.includes('vite/preload-helper')) return 'vendor-preload';
          if (id.includes('music_room')) return 'env-music-room';
          if (id.includes('living_room')) return 'env-living-room';
          if (id.includes('city')) return 'env-city';
          if (id.includes('park')) return 'env-park';

          if (id.includes('node_modules')) {
            if (id.includes('/node_modules/three/')) return 'vendor-three';
            // Keep the whole @react-three family (fiber/drei/xr) in one chunk:
            // they cross-reference, so splitting drei out creates a circular
            // chunk. The real win for this stack is route-level lazy loading
            // (deferred Phase 1), not finer vendor slicing.
            if (id.includes('/node_modules/@react-three/')) return 'vendor-react-three';
            if (id.includes('/node_modules/postprocessing/')) return 'vendor-postprocess';
            if (id.includes('/node_modules/@tanstack/')) return 'vendor-query';
            if (id.includes('/node_modules/zustand/')) return 'vendor-state';
            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'vendor-react';
          }
        },
      },
    },
  },
  server: {
    // Port is overridable via VITE_DEV_PORT so parallel checkouts / preview
    // tools can each pin a distinct port. strictPort makes a conflict FAIL LOUDLY
    // instead of silently hopping to the next free port — silent hopping desyncs
    // any tool that expects the requested port (preview harness, screenshots).
    port: Number(process.env.VITE_DEV_PORT) || 3000,
    strictPort: true,
    proxy: {
      // The production app serves scientific catalog routes from the same
      // Cloudflare Worker. During Vite development, forward only that narrow
      // namespace to a local `wrangler dev` process so the UI exercises the
      // real edge contract instead of a browser-only mock.
      '/v1/datasets': {
        target: process.env.VITE_DATA_EDGE_ORIGIN || 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/__lupi_gcs': {
        target: 'https://storage.googleapis.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/__lupi_gcs/, ''),
      },
    },
    headers: {
      // Firebase popup/redirect sign-in needs the opener relationship preserved,
      // so COOP must allow popups. We intentionally do NOT set
      // Cross-Origin-Embedder-Policy: require-corp here:
      //   - nothing in this app uses SharedArrayBuffer / cross-origin isolation
      //     (and with COOP=same-origin-allow-popups the page isn't isolated
      //     anyway, so require-corp bought zero benefit), and
      //   - require-corp forces Firebase's cross-origin auth iframe to be
      //     CORP-eligible, which it isn't — so it silently blocks the popup
      //     from returning the credential and sign-in "completes" but the app
      //     stays logged out.
      'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    },
  },
}));
