/**
 * SciencePanelDemo — isolated demo route for the Z1 science panel prototype.
 *
 * Loads the static golden-set fixture (paths 16, 0, 14, 27) and renders one
 * SciencePathPanel per selected path. Reachable at `?demo=science-panel`
 * (optionally `&path=<16|0|14|27>`) or `#/demo/science-panel`.
 *
 * This route exists so the panel can be reviewed and screenshot-tested
 * without the 3D viewer; production wiring belongs to the manifest-native
 * bundle load path (phase 2), not to this prototype.
 */

import { useMemo, useState } from 'react';
import { SciencePathPanel } from './SciencePathPanel';
import type { SciencePanelFixture } from './sciencePanelTypes';
import fixtureJson from './z1GoldenPanelFixture.json';

const fixture = fixtureJson as unknown as SciencePanelFixture;

const PATH_BLURB: Record<number, string> = {
  16: 'seemingly good cross-engine result that is T1-contaminated',
  0: 'large-wander mechanism case',
  14: 'all four guides failed; dense extension supplied the profile',
  27: 'the only T1-clean path',
};

export function SciencePanelDemo() {
  const initialPath = useMemo(() => {
    if (typeof window === 'undefined') return fixture.paths[0].pathIndex;
    const wanted = Number(new URLSearchParams(window.location.search).get('path'));
    return fixture.paths.some((p) => p.pathIndex === wanted) ? wanted : fixture.paths[0].pathIndex;
  }, []);
  const [selectedPath, setSelectedPath] = useState(initialPath);
  const [currentImage, setCurrentImage] = useState(0);

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
