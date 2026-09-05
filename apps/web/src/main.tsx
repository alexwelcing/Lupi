import { createRoot, type Root } from 'react-dom/client';
import { Suspense, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  currentHashRoute,
  currentPathRoute,
  normalizedPathRoute,
  savedViewSlugFromRoute,
  isBillionAtomsRoute,
  isTestbedRoute,
  isEmojiRoute,
  isEmbeddedMobileViewerRoute,
  isMcpViewerRoute,
  isScienceDemoRoute,
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
 * Retired research URLs get an explicit handoff, never a synthetic demo.
 *
 * We decide from the URL ALONE, before importing anything heavy.
 */

const params = new URLSearchParams(window.location.search);
const retiredResearchRoute =
  params.get('view') === 'compare' ||
  [
    '/materials/omol25',
    '/materials/omol25-molecule-geometry',
    '/materials/million-atom-viewer',
    '/scenes/1m-copper-lattice',
    '/research',
  ].includes(normalizedPathRoute(currentPathRoute())) ||
  currentHashRoute().split('?')[0] === '/system/mlip-flywheel' ||
  ['research', 'potentials', 'equilibrium', 'omol25'].includes(params.get('tab') ?? '');
const educationKind = SEO_EDUCATION_ROUTES[normalizedPathRoute(currentPathRoute())] ?? null;

/**
 * URL-only signals that the viewer (App) should load immediately instead of the
 * landing shell: an explicit molecule/state to restore, or any non-landing
 * route (saved view, scene, SEO study page, MLIP, MCP, testbed, emoji).
 */
function wantsViewerImmediately(): boolean {
  if (params.has('load') || params.has('sim') || params.has('s') || params.has('fly')) return true;
  if (isTestbedRoute() || isEmojiRoute() || isBillionAtomsRoute()) return true;
  if (isScienceDemoRoute()) return true;
  const hashPath = currentHashRoute().split('?')[0] || '/';
  if (hashPath === '/system/mlip-flywheel') return true;
  if (isEmbeddedMobileViewerRoute(hashPath)) return true;
  if (isMcpViewerRoute(hashPath)) return true;
  if (savedViewSlugFromRoute(hashPath)) return true;
  const normalizedPath = normalizedPathRoute(currentPathRoute());
  if (savedViewSlugFromRoute(normalizedPath)) return true;
  if (normalizedPath === '/scenes/1m-copper-lattice') return true;
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

declare global {
  interface Window {
    /** Preserve the React root when Vite reloads this entry during live visual work. */
    __lupiReactRoot?: Root;
  }
}

const rootElement = document.getElementById('root')!;
const root = (window.__lupiReactRoot ??= createRoot(rootElement));

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
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          opacity: 0.9,
          animation: 'lupiSplashPulse 1.4s ease-in-out infinite',
        }}
      >
        Lupi
      </div>
      <style>{`@keyframes lupiSplashPulse { 0%,100% { opacity: 0.45 } 50% { opacity: 0.95 } }`}</style>
    </div>
  );
}

function renderError(stage: string, err: any) {
  console.error(`[lupi] ${stage} FAILED:`, err);
  root.render(
    <div
      style={{
        padding: 40,
        background: '#06080d',
        color: '#ff5472',
        height: '100vh',
        fontFamily: 'monospace',
        whiteSpace: 'pre-wrap',
      }}
    >
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

async function mountEducation(kind: NonNullable<typeof educationKind>) {
  try {
    const mod = await import('@atlas/ui/landing/SeoEducationShell');
    root.render(withProviders(<mod.SeoEducationShell kind={kind} />));
  } catch (err) {
    renderError('Education page import', err);
  }
}

if (retiredResearchRoute) {
  document.title = 'Retired workspace | Lupi';
  document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex,follow');
  root.render(
    <div
      style={{
        minHeight: '100vh',
        padding: '64px 24px',
        background: '#101817',
        color: '#eff3e9',
        font: '16px/1.6 system-ui',
      }}
    >
      <main style={{ maxWidth: 600, margin: 'auto' }}>
        <p>Lupi</p>
        <h1>This research workspace has retired from Lupi.</h1>
        <p>
          Lupi now focuses on exploring and learning from molecular structures. Research execution and large
          dataset browsing are separate from the learning app.
        </p>
        <p>
          <a style={{ color: '#d5ef9c' }} href="/">
            Explore the learning collection
          </a>
        </p>
        <p>
          <a style={{ color: '#d5ef9c' }} href="https://lupine.science">
            Visit Lupine Science ↗
          </a>
        </p>
      </main>
    </div>,
  );
} else if (wantsViewerImmediately()) {
  void mountViewer();
} else if (educationKind) {
  void mountEducation(educationKind);
} else {
  void mountLanding();
}
