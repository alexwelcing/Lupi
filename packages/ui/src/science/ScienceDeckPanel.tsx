/**
 * ScienceDeckPanel — the Z1 science panel as viewer-native chrome.
 *
 * Binds the validated golden-path fixture (via SciencePathPanel's data path)
 * to the viewer's command panel: dark-glass theme, compact deck variant, and
 * a path switcher that navigates the normalized `#/science/<index>` route so
 * switching paths goes through the same load pipeline as everything else.
 *
 * The frame ↔ image sync is owned by the caller (ViewerPanelBody's science
 * surface): `currentImage` is the viewer frame and `onImageChange` writes it
 * back, so the scrubber, transport, plots, and stepper all address the same
 * zero-based NEB image.
 */

import { SciencePathPanel, type SciencePanelTheme } from './SciencePathPanel';
import type { ScienceViewerBundle } from './scienceBundle';
import { DEFAULT_Z1_SCIENCE_PATH_INDEX } from './scienceBundle';

/**
 * Dark-glass palette matching the command deck (`#22d3d7` accent, `#081019`
 * sections, `#22303d` borders). GPAW anchors take the viewer accent — they
 * are the primary evidence and should read as first-class viewer content.
 */
export const SCIENCE_VIEWER_THEME: SciencePanelTheme = {
  paper: '#050a10',
  ink: '#e8f0f7',
  indigo: '#22d3d7',
  ochre: '#e8bf83',
  grid: '#22303d',
  muted: '#718397',
  readoutBg: '#0a1119',
  bannerOkBg: 'rgba(34, 211, 215, 0.08)',
  bannerWarnBg: 'rgba(232, 191, 131, 0.09)',
  modelStrokes: [
    { stroke: '#8b9aab', dash: '6 3' },
    { stroke: '#a8b4c4', dash: '2 2' },
    { stroke: '#67748a', dash: '8 3 2 3' },
    { stroke: '#c4cedb', dash: '1 2' },
  ],
};

export interface ScienceDeckPanelProps {
  bundle: ScienceViewerBundle;
  currentImage: number;
  onImageChange: (image: number) => void;
}

export function ScienceDeckPanel({ bundle, currentImage, onImageChange }: ScienceDeckPanelProps) {
  const { fixture, path } = bundle;
  return (
    <div data-testid="science-deck-panel" style={{ padding: 12, display: 'grid', gap: 12 }}>
      {/* Golden-path switcher: writes the canonical route; the shell's science
          route effect loads the matching trajectory + bundle. */}
      <nav aria-label="Z1 golden paths" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {fixture.paths.map((p) => {
          const active = p.pathIndex === path.pathIndex;
          return (
            <a
              key={p.pathIndex}
              href={`#/science/${p.pathIndex}`}
              data-testid={`science-deck-path-${p.pathIndex}`}
              aria-current={active ? 'true' : undefined}
              style={{
                padding: '5px 10px',
                borderRadius: 5,
                border: `1px solid ${active ? '#22d3d7' : '#22303d'}`,
                background: active ? 'rgba(34, 211, 215, 0.12)' : '#081019',
                color: active ? '#dffeff' : '#8ceef0',
                fontSize: 11,
                fontWeight: 700,
                textDecoration: 'none',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              }}
            >
              path {p.pathIndex}
            </a>
          );
        })}
      </nav>
      <SciencePathPanel
        data={path}
        fixture={fixture}
        currentImage={currentImage}
        onImageChange={onImageChange}
        theme={SCIENCE_VIEWER_THEME}
        variant="deck"
      />
    </div>
  );
}

export { DEFAULT_Z1_SCIENCE_PATH_INDEX };
