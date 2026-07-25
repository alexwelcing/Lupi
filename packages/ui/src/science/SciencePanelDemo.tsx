/**
 * SciencePanelDemo — isolated demo route for the Z1 science panel prototype.
 *
 * Loads the static golden-set fixture (paths 16, 0, 14, 27) and renders one
 * SciencePathPanel per selected path. Canonical route: `#/science/<index>`
 * (normalized like `/view/:slug`); legacy aliases `?demo=science-panel`
 * (optionally `&path=<16|0|14|27>`) and `#/demo/science-panel` still work.
 *
 * The fixture is validated fail-closed before anything renders: a drifted,
 * mis-regenerated, or corrupted fixture must never become guessed or partial
 * science on screen. See sciencePanelValidation.ts.
 *
 * This route exists so the panel can be reviewed and screenshot-tested
 * without the 3D viewer; production wiring belongs to the manifest-native
 * bundle load path (phase 2), not to this prototype.
 */

import { useEffect, useMemo, useState } from 'react';
import { SciencePathPanel } from './SciencePathPanel';
import type { SciencePanelFixture } from './sciencePanelTypes';
import { validateSciencePanelFixture } from './sciencePanelValidation';
import { currentHashRoute, sciencePathIndexFromRoute } from '../viewer/viewerRoutes';
import fixtureJson from './z1GoldenPanelFixture.json';

const PATH_BLURB: Record<number, string> = {
  16: 'seemingly good cross-engine result that is T1-contaminated',
  0: 'large-wander mechanism case',
  14: 'all four guides failed; dense extension supplied the profile',
  27: 'the only T1-clean path',
};

/** Fail-closed state: never render a partial or guessed panel from bad bytes. */
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
        Science fixture invalid — panel withheld
      </h1>
      <p style={{ fontSize: 13, margin: '0 0 10px' }}>
        The Z1 panel fixture failed validation. The panel does not render guessed or partial science from a fixture
        that drifted, was regenerated incorrectly, or was corrupted. Rebuild the fixture with{' '}
        <code>tools/build-z1-science-panel-fixture.mjs</code> and verify it before shipping.
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
  /** Test seam: override the fixture payload (validated before render). Defaults to the shipped JSON. */
  fixture?: unknown;
}

export function SciencePanelDemo({ fixture: fixtureInput }: SciencePanelDemoProps) {
  const raw = fixtureInput ?? fixtureJson;
  const validation = useMemo(() => validateSciencePanelFixture(raw), [raw]);
  const initialPath = useMemo(() => {
    if (!validation.ok) return 0;
    const fixture = raw as SciencePanelFixture;
    if (typeof window === 'undefined') return fixture.paths[0].pathIndex;
    const fromRoute = sciencePathIndexFromRoute(currentHashRoute());
    if (fromRoute != null && fixture.paths.some((p) => p.pathIndex === fromRoute)) return fromRoute;
    const wanted = Number(new URLSearchParams(window.location.search).get('path'));
    return fixture.paths.some((p) => p.pathIndex === wanted) ? wanted : fixture.paths[0].pathIndex;
  }, [raw, validation.ok]);
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [currentImage, setCurrentImage] = useState(0);

  // Route ↔ tab synchronization: hash changes (landing cards, back/forward)
  // select the tab; tab clicks write the canonical route.
  useEffect(() => {
    if (!validation.ok) return;
    const fixture = raw as SciencePanelFixture;
    const onHash = () => {
      const idx = sciencePathIndexFromRoute(currentHashRoute());
      if (idx != null && fixture.paths.some((p) => p.pathIndex === idx)) {
        setSelectedPath(idx);
        setCurrentImage(0);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [raw, validation.ok]);

  const selectPath = (index: number) => {
    setSelectedPath(index);
    setCurrentImage(0);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#/science/${index}`);
    }
  };

  useEffect(() => {
    if (!validation.ok) {
      console.error('[science-panel] fixture invalid — failing closed:', validation.errors);
    }
  }, [validation]);

  if (!validation.ok) {
    return <ScienceFixtureInvalid errors={validation.errors} />;
  }

  const fixture = raw as SciencePanelFixture;
  const data = fixture.paths.find((p) => p.pathIndex === selectedPath) ?? fixture.paths[0];

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
          Z1 science panel — golden-set prototype
        </h1>
        <p style={{ fontSize: 12, color: '#6b6f7a', margin: 0 }}>
          Reaction-path sequences (climbing-image NEB) from the Z1 union campaign. No time axes, no thermo minimap.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }} data-testid="science-demo-tabs">
          {fixture.paths.map((p) => (
            <button
              key={p.pathIndex}
              onClick={() => selectPath(p.pathIndex)}
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
