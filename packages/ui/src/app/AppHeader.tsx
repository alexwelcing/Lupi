import { memo } from 'react';
import { useStore } from '../store';
import { FlexRow } from '../primitives/AppShell';
import { IconClose } from '../icons';
import { SavedViewButton } from '../SavedViewButton';
import { LupiAgentDock } from '../LupiAgentDock';
import { LupiAuthCallout } from '../LupiAuthCallout';
import { openRandomOmol25Molecule } from '../molecules/randomOmol';

const atomCountFormatter = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const AppHeader = memo(function AppHeader({
  isMobile,
  clearLoadedFile,
}: {
  isMobile: boolean;
  clearLoadedFile: () => void;
}) {
  // Primitive selectors keep streaming-frame inserts from repainting this
  // stable status bar while a trajectory is playing.
  const fileLoaded = useStore(s => Boolean(s.file));
  const fileName = useStore(s => s.file?.name ?? '');
  const atomCount = useStore(s => s.file?.trajectory.frames.find(Boolean)?.natoms ?? 0);
  const totalFrames = useStore(s => s.file?.trajectory.totalFrames ?? 0);
  const mobileLoadedHeader = isMobile && fileLoaded;
  const statusSummary = atomCount > 0
    ? `${atomCountFormatter.format(atomCount)} atoms${totalFrames > 1 ? ` · ${totalFrames} frames` : ''}`
    : totalFrames > 1 ? `${totalFrames} frames` : '';

  return (
    <>
      <header
        className={fileLoaded ? 'lupine-status-bar' : ''}
        style={{
          height: 'var(--app-header-height)',
          minHeight: 'var(--app-header-height)',
          flexShrink: 0,
          display: mobileLoadedHeader ? 'grid' : 'flex',
          alignItems: 'center',
          justifyContent: mobileLoadedHeader ? undefined : 'space-between',
          gridTemplateColumns: mobileLoadedHeader ? 'auto minmax(0, 1fr) auto' : undefined,
          gridTemplateRows: mobileLoadedHeader ? '38px 28px' : undefined,
          columnGap: mobileLoadedHeader ? 8 : undefined,
          rowGap: mobileLoadedHeader ? 2 : undefined,
          padding: mobileLoadedHeader ? 'calc(env(safe-area-inset-top) + 10px) 10px 6px' : (isMobile ? 'env(safe-area-inset-top) 8px 0' : '0 16px'),
          margin: fileLoaded ? (isMobile ? '0 8px 0' : '14px 16px 0') : 0,
          borderRadius: fileLoaded ? 8 : 0,
          borderBottom: fileLoaded ? 'none' : '1px solid var(--border-subtle)',
          background: fileLoaded ? undefined : 'var(--bg-glass)',
          zIndex: 200,
        }}
      >
        <FlexRow
          gap={isMobile ? 6 : 12}
          className="lupine-truncate"
          style={{
            gridColumn: mobileLoadedHeader ? '1 / 2' : undefined,
            gridRow: mobileLoadedHeader ? '1' : undefined,
          }}
        >
          <button
            onClick={() => { if (fileLoaded) clearLoadedFile(); }}
            aria-label={fileLoaded ? 'Return to Lupi home' : 'Lupi home'}
            className="lupine-btn icon-only"
            style={{
              background: 'transparent',
              borderColor: 'transparent',
              boxShadow: 'none',
              padding: isMobile ? '0 2px' : 6,
              gap: 4,
              cursor: fileLoaded ? 'pointer' : 'default',
              height: isMobile ? 34 : undefined,
              minHeight: isMobile ? 34 : undefined,
              aspectRatio: isMobile ? 'auto' : undefined,
              flexShrink: 0,
            }}
          >
            <span style={{
              fontSize: isMobile ? 19 : 21, fontWeight: 750, color: 'var(--text-primary)',
              letterSpacing: 0
            }}>
              Lupi
            </span>
          </button>

          {fileLoaded && !isMobile && (
            <>
              <div className="lupine-divider" />
              <span style={{ display: 'grid', gap: 1, minWidth: 0, maxWidth: 300 }}>
                <span
                  className="lupine-truncate"
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    fontWeight: 650,
                    lineHeight: 1.2,
                  }}
                  title={fileName}
                >
                  {fileName}
                </span>
                {statusSummary && <span className="lupine-status-bar__readout">{statusSummary}</span>}
              </span>
              <button
                onClick={clearLoadedFile}
                title="Close"
                aria-label="Close dataset"
                className="lupine-icon-btn"
                style={{ width: 28, height: 28 }}
              >
                <IconClose />
              </button>
            </>
          )}
        </FlexRow>

        {fileLoaded && isMobile && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              gridColumn: '1 / -1',
              gridRow: '2',
              padding: '0 1px',
            }}
          >
            <span
              title={fileName}
              className="lupine-truncate"
              style={{
                flex: '1 1 auto',
                fontSize: 12,
                color: 'var(--text-primary)',
                fontWeight: 650,
                lineHeight: 1.15,
              }}
            >
              {fileName}
            </span>
            {statusSummary && <span className="lupine-status-bar__readout">{statusSummary}</span>}
            <button
              onClick={clearLoadedFile}
              title="Close"
              aria-label="Close dataset"
              className="lupine-icon-btn"
              style={{ width: 28, height: 28, flexShrink: 0 }}
            >
              <IconClose />
            </button>
          </div>
        )}

        <FlexRow
          gap={isMobile ? 4 : 10}
          style={{
            justifyContent: 'flex-end',
            minWidth: 0,
            gridColumn: mobileLoadedHeader ? '2 / 4' : undefined,
            gridRow: mobileLoadedHeader ? '1' : undefined,
            justifySelf: mobileLoadedHeader ? 'end' : undefined,
          }}
        >
          {!fileLoaded && (
            <>
              <a
                href="#gallery"
                onClick={(e) => {
                  const el = document.getElementById('gallery');
                  if (el) {
                    e.preventDefault();
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
                className="lupine-btn"
                style={{
                  padding: isMobile ? '7px 9px' : '8px 12px',
                  fontSize: isMobile ? 12 : 13,
                  minHeight: isMobile ? 34 : undefined,
                }}
              >
                Gallery
              </a>
              <button
                onClick={() => void openRandomOmol25Molecule()}
                className="lupine-btn primary"
                style={{
                  padding: isMobile ? '7px 10px' : '8px 14px',
                  fontSize: isMobile ? 12 : 14,
                  minHeight: isMobile ? 34 : undefined,
                }}
              >
                {isMobile ? 'View' : 'View a molecule'}
              </button>
            </>
          )}
          {fileLoaded && <SavedViewButton compact={isMobile} />}
          <LupiAgentDock compact={isMobile} />
        </FlexRow>
      </header>
      <LupiAuthCallout compact={isMobile} />
    </>
  );
});
