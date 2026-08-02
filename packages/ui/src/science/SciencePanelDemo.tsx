/**
 * SciencePanelDemo — isolated review route for canonical Z1 bundles.
 *
 * Resolves the exact, content-addressed `lupine.visualization-bundle.v1`
 * manifests (paths 16, 0, 14, 27) and renders one SciencePathPanel per
 * selected path. Reachable at `?demo=science-panel`
 * (optionally `&path=<16|0|14|27>`) or `#/demo/science-panel`.
 *
 * Unknown or invalid canonical identities fail closed before anything renders.
 * This route exists so the adapter and panel can be reviewed and screenshot-
 * tested without a bespoke projection fixture.
 */

import { useEffect, useMemo, useState } from 'react';
import { SciencePathPanel } from './SciencePathPanel';
import {
  DEFAULT_Z1_SCIENCE_PATH_INDEX,
  verifiedSciencePanelBundleForPathIndex,
  type ScienceViewerBundle,
} from './scienceBundle';

const PATH_BLURB: Record<number, string> = {
  16: 'seemingly good cross-engine result that is T1-contaminated',
  0: 'large-wander mechanism case',
  14: 'all four guides failed; dense extension supplied the profile',
  27: 'the only T1-clean path',
};

/** Fail-closed state: never render a partial or guessed panel from bad canonical bytes. */
export function ScienceFixtureInvalid({ errors }: { errors: string[] }) {
  return (
    <div
      data-testid="science-fixture-invalid"
      role="alert"
      style={{
        maxWidth: 900,
        margin: '40px auto',
        padding: '20px 22px',
        background: '#faf9f6',
        color: '#16171d',
        border: '2px solid #b97a1c',
        borderRadius: 8,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <h1 style={{ fontSize: 17, margin: '0 0 6px', color: '#b97a1c' }}>
        Canonical science bundle unavailable — panel withheld
      </h1>
      <p style={{ fontSize: 13, margin: '0 0 10px' }}>
        The selected Z1 visualization bundle failed canonical resolution or validation. The panel does not render
        guessed or partial science from missing, stale, or corrupted identities.
      </p>
      <ul style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', margin: 0, paddingLeft: 18 }}>
        {errors.slice(0, 20).map((e) => (
          <li key={e}>{e}</li>
        ))}
        {errors.length > 20 && <li>… and {errors.length - 20} more</li>}
      </ul>
    </div>
  );
}

export interface SciencePanelDemoProps {
  /** Exact canonical path selection. Unknown indices fail closed. */
  pathIndex?: number;
}

export function SciencePanelDemo({ pathIndex }: SciencePanelDemoProps) {
  const initialPath = useMemo(() => {
    if (pathIndex != null) return pathIndex;
    if (typeof window === 'undefined') return DEFAULT_Z1_SCIENCE_PATH_INDEX;
    const rawPath = new URLSearchParams(window.location.search).get('path');
    return rawPath == null ? DEFAULT_Z1_SCIENCE_PATH_INDEX : Number(rawPath);
  }, [pathIndex]);
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [currentImage, setCurrentImage] = useState(0);
  const [bundle, setBundle] = useState<ScienceViewerBundle | null>();

  useEffect(() => {
    setSelectedPath(initialPath);
    setCurrentImage(0);
  }, [initialPath]);

  useEffect(() => {
    let cancelled = false;
    setBundle(undefined);
    void verifiedSciencePanelBundleForPathIndex(selectedPath).then((resolved) => {
      if (cancelled) return;
      if (!resolved) {
        console.error('[science-panel] canonical bundle unavailable — failing closed:', selectedPath);
      }
      setBundle(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  if (bundle === undefined) {
    return <div data-testid="science-bundle-loading" role="status">Verifying canonical science bundle…</div>;
  }

  if (!bundle) {
    return <ScienceFixtureInvalid errors={[`No active canonical visualization bundle for path ${selectedPath}`]} />;
  }

  const { fixture, path: data } = bundle;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#e9e7e0',
        padding: '28px 18px 60px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div style={{ maxWidth: 1060, margin: '0 auto 14px' }}>
        <h1 style={{ fontSize: 17, margin: '0 0 2px', color: '#16171d' }}>
          Z1 science panel — canonical visualization bundles
        </h1>
        <p style={{ fontSize: 12, color: '#6b6f7a', margin: 0 }}>
          Reaction-path sequences (climbing-image NEB) from the Z1 union campaign. No time axes, no thermo minimap.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }} data-testid="science-demo-tabs">
          {fixture.paths.map((p) => (
            <button
              key={p.pathIndex}
              onClick={() => {
                setSelectedPath(p.pathIndex);
                setCurrentImage(0);
              }}
              data-testid={`science-demo-tab-${p.pathIndex}`}
              style={{
                textAlign: 'left',
                padding: '7px 12px',
                borderRadius: 5,
                border: `1.5px solid ${p.pathIndex === selectedPath ? '#3d4db3' : '#cfccc2'}`,
                background: p.pathIndex === selectedPath ? '#eef0fa' : '#faf9f6',
                color: '#16171d',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              <strong>path {p.pathIndex}</strong>
              <span style={{ display: 'block', color: '#6b6f7a', fontSize: 11 }}>{PATH_BLURB[p.pathIndex] ?? ''}</span>
            </button>
          ))}
        </div>
      </div>

      <SciencePathPanel
        key={data.pathIndex}
        data={data}
        fixture={fixture}
        currentImage={currentImage}
        onImageChange={setCurrentImage}
      />
    </div>
  );
}

export default SciencePanelDemo;
