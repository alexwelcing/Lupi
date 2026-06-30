import { createRoot } from 'react-dom/client';
import { Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  currentHashRoute,
  currentPathRoute,
  normalizedPathRoute,
  savedViewSlugFromRoute,
  isTestbedRoute,
  isEmojiRoute,
  isMcpViewerRoute,
  SEO_EDUCATION_ROUTES,
} from '@atlas/ui/viewer/viewerRoutes';

/**
 * Entry router. The marketing landing and the 3D viewer are two separately
 * code-split modules:
 *
 *   - LandingShell  — plain marketing visit; imports ZERO three/R3F/drei, so
 *                     the ~1MB-gzip viewer stack stays off the critical path.
 *   - App           — the full viewer; loaded on demand the moment a molecule
 *                     is requested (deep link, or LandingShell hand-off).
 *   - ComparisonTheater — the ?view=compare side-by-side.
 *
 * We decide from the URL ALONE, before importing anything heavy.
 */

const params = new URLSearchParams(window.location.search);
const isCompare = params.get('view') === 'compare';

/**
 * URL-only signals that the viewer (App) should load immediately instead of the
 * landing shell: an explicit molecule/state to restore, or any non-landing
 * route (saved view, scene, SEO study page, MLIP, MCP, testbed, emoji).
 */
function wantsViewerImmediately(): boolean {
  if (params.has('load') || params.has('sim') || params.has('s') || params.has('fly')) return true;
  if (isTestbedRoute() || isEmojiRoute()) return true;
  const hashPath = currentHashRoute().split('?')[0] || '/';
  if (hashPath === '/system/mlip-flywheel') return true;
  if (isMcpViewerRoute(hashPath)) return true;
  if (savedViewSlugFromRoute(hashPath)) return true;
  const normalizedPath = normalizedPathRoute(currentPathRoute());
  if (savedViewSlugFromRoute(normalizedPath)) return true;
  if (normalizedPath === '/scenes/1m-copper-lattice') return true;
  if (SEO_EDUCATION_ROUTES[normalizedPath]) return true;
  return false;
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min
      retry: 1,
    },
  },
});

const root = createRoot(document.getElementById('root')!);

function withProviders(node: ReactNode) {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<Splash />}>{node}</Suspense>
    </QueryClientProvider>
  );
}

/** Brand splash shown while the viewer chunk (three/R3F) downloads. */
function Splash() {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#020204',
        color: '#7dd3fc',
        fontFamily: 'system-ui, sans-serif',
        letterSpacing: '0.04em',
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, opacity: 0.9, animation: 'lupiSplashPulse 1.4s ease-in-out infinite' }}>
        Lupi
      </div>
      <style>{`@keyframes lupiSplashPulse { 0%,100% { opacity: 0.45 } 50% { opacity: 0.95 } }`}</style>
    </div>
  );
}

function renderError(stage: string, err: any) {
  console.error(`[lupi] ${stage} FAILED:`, err);
  root.render(
    <div style={{ padding: 40, background: '#06080d', color: '#ff5472', height: '100vh', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
      <h2 style={{ color: '#00c8f0', marginBottom: 16 }}>LUPI - {stage} Error</h2>
      {err?.message}
      {'\n'}
      {err?.stack}
    </div>,
  );
}

/** Load and mount the full 3D viewer (App). Shows the splash while it downloads. */
async function mountViewer() {
  root.render(<Splash />);
  try {
    const mod = await import('@atlas/ui/App');
    root.render(withProviders(<mod.default />));
  } catch (err) {
    renderError('Viewer import', err);
  }
}

async function mountCompare() {
  root.render(<Splash />);
  try {
    const mod = await import('@atlas/ui/compare/ComparisonTheater');
    root.render(withProviders(<mod.default />));
  } catch (err) {
    renderError('Comparison Theater import', err);
  }
}

async function mountLanding() {
  try {
    const mod = await import('@atlas/ui/LandingShell');
    const LandingShell = mod.LandingShell;
    // No Suspense fallback needed here: LandingShell and its closure are static
    // imports in this chunk, so the landing paints as soon as the module loads.
    root.render(
      <QueryClientProvider client={queryClient}>
        <LandingShell onEnterViewer={mountViewer} />
      </QueryClientProvider>,
    );
  } catch (err) {
    renderError('Landing import', err);
  }
}

if (isCompare) {
  void mountCompare();
} else if (wantsViewerImmediately()) {
  void mountViewer();
} else {
  void mountLanding();
}
